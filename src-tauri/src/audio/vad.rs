//! Energy-threshold voice activity detection, segmenting a continuous PCM
//! stream into discrete speech phrases. Ports the algorithm from
//! `pluely-master`'s `run_vad_capture`
//! (src-tauri/src/speaker/commands.rs:135-257 in that project), using the
//! parameter values already specified in docs/TECHNICAL_DESIGN.md section
//! 4.4. No neural VAD model; energy threshold is enough for system-audio
//! input, which is relatively clean compared to a live microphone.

use std::collections::VecDeque;

/// Tunable thresholds. Values match docs/TECHNICAL_DESIGN.md section 4.4
/// and pluely-master's defaults.
#[derive(Debug, Clone, Copy)]
pub struct VadConfig {
    /// Number of samples analyzed per RMS/peak check.
    pub hop_size: usize,
    /// RMS level above which a hop is considered speech.
    pub sensitivity_rms: f32,
    /// Peak level above which a hop is considered speech (OR'd with RMS).
    pub peak_threshold: f32,
    /// Soft-knee noise gate threshold applied before RMS/peak calculation.
    pub noise_gate_threshold: f32,
    /// Minimum consecutive silent hops after speech before the segment ends.
    pub silence_hops: u32,
    /// Minimum consecutive speech hops for a segment to be kept (shorter
    /// bursts are discarded as noise/clicks).
    pub min_speech_hops: u32,
    /// Rolling pre-speech buffer length in hops, prepended to a segment so
    /// the first word isn't clipped.
    pub pre_speech_hops: u32,
    /// Hard cap on segment length; a segment is force-flushed at this point
    /// even without a silence gap.
    pub max_segment_samples: usize,
}

impl VadConfig {
    /// Builds a config from the millisecond-based parameters specified in
    /// docs/TECHNICAL_DESIGN.md section 4.4, resolved against the actual
    /// capture sample rate.
    pub fn from_millis(sample_rate: u32) -> Self {
        const HOP_SIZE: usize = 1024;
        let hop_duration_ms = (HOP_SIZE as f32 / sample_rate as f32) * 1000.0;

        const MIN_SPEECH_MS: f32 = 300.0;
        const END_SILENCE_MS: f32 = 700.0;
        const MAX_SEGMENT_MS: f32 = 15_000.0;
        const PRE_ROLL_MS: f32 = 300.0;

        Self {
            hop_size: HOP_SIZE,
            sensitivity_rms: 0.012,
            peak_threshold: 0.035,
            noise_gate_threshold: 0.003,
            silence_hops: (END_SILENCE_MS / hop_duration_ms).ceil() as u32,
            min_speech_hops: (MIN_SPEECH_MS / hop_duration_ms).ceil() as u32,
            pre_speech_hops: (PRE_ROLL_MS / hop_duration_ms).ceil() as u32,
            max_segment_samples: ((MAX_SEGMENT_MS / 1000.0) * sample_rate as f32) as usize,
        }
    }
}

/// A completed speech segment, ready to be WAV-encoded and transcribed.
pub struct SpeechSegment {
    pub samples: Vec<f32>,
}

/// What happened as a result of feeding one sample into the segmenter.
pub enum SegmenterEvent {
    /// No state change worth reporting.
    None,
    /// Speech just started (crossed from silence into the speech state).
    SpeechStarted,
    /// A complete segment is ready (either a natural silence-triggered end,
    /// or a max-duration force-flush).
    SegmentReady(SpeechSegment),
    /// A burst was too short to count as real speech and was discarded.
    Discarded,
}

/// Stateful energy-threshold segmenter. Feed it samples one at a time via
/// `push`; it reports segment boundaries through `SegmenterEvent`.
pub struct Segmenter {
    config: VadConfig,
    hop_buffer: Vec<f32>,
    pre_speech: VecDeque<f32>,
    speech_buffer: Vec<f32>,
    in_speech: bool,
    silence_hop_count: u32,
    speech_hop_count: u32,
}

impl Segmenter {
    pub fn new(config: VadConfig) -> Self {
        Self {
            hop_buffer: Vec::with_capacity(config.hop_size),
            pre_speech: VecDeque::with_capacity(config.pre_speech_hops as usize * config.hop_size),
            speech_buffer: Vec::new(),
            in_speech: false,
            silence_hop_count: 0,
            speech_hop_count: 0,
            config,
        }
    }

    /// Feeds one PCM sample into the segmenter. Returns an event if this
    /// sample completed a hop-sized analysis window and something notable
    /// happened.
    pub fn push(&mut self, sample: f32) -> SegmenterEvent {
        self.hop_buffer.push(sample);
        if self.hop_buffer.len() < self.config.hop_size {
            return SegmenterEvent::None;
        }

        let hop = std::mem::replace(
            &mut self.hop_buffer,
            Vec::with_capacity(self.config.hop_size),
        );
        self.process_hop(hop)
    }

    fn process_hop(&mut self, hop: Vec<f32>) -> SegmenterEvent {
        let gated = apply_noise_gate(&hop, self.config.noise_gate_threshold);
        let (rms, peak) = calculate_metrics(&gated);
        let is_speech = rms > self.config.sensitivity_rms || peak > self.config.peak_threshold;

        if is_speech {
            self.handle_speech_hop(gated)
        } else {
            self.handle_silence_hop(gated)
        }
    }

    fn handle_speech_hop(&mut self, hop: Vec<f32>) -> SegmenterEvent {
        let just_started = !self.in_speech;
        if just_started {
            self.in_speech = true;
            self.speech_hop_count = 0;
            self.speech_buffer.extend(self.pre_speech.drain(..));
        }

        self.speech_hop_count += 1;
        self.speech_buffer.extend_from_slice(&hop);
        self.silence_hop_count = 0;

        if self.speech_buffer.len() >= self.config.max_segment_samples {
            let segment = self.flush_segment();
            return SegmenterEvent::SegmentReady(segment);
        }

        if just_started {
            SegmenterEvent::SpeechStarted
        } else {
            SegmenterEvent::None
        }
    }

    fn handle_silence_hop(&mut self, hop: Vec<f32>) -> SegmenterEvent {
        if !self.in_speech {
            self.pre_speech.extend(hop);
            let max_len = self.config.pre_speech_hops as usize * self.config.hop_size;
            while self.pre_speech.len() > max_len {
                self.pre_speech.pop_front();
            }
            return SegmenterEvent::None;
        }

        self.silence_hop_count += 1;
        self.speech_buffer.extend_from_slice(&hop);

        if self.silence_hop_count < self.config.silence_hops {
            return SegmenterEvent::None;
        }

        // Silence gap satisfied: end the segment.
        let long_enough = self.speech_hop_count >= self.config.min_speech_hops;
        let segment_samples = std::mem::take(&mut self.speech_buffer);
        self.in_speech = false;
        self.silence_hop_count = 0;
        self.speech_hop_count = 0;

        if long_enough && !segment_samples.is_empty() {
            SegmenterEvent::SegmentReady(SpeechSegment {
                samples: segment_samples,
            })
        } else {
            SegmenterEvent::Discarded
        }
    }

    fn flush_segment(&mut self) -> SpeechSegment {
        let segment_samples = std::mem::take(&mut self.speech_buffer);
        self.in_speech = false;
        self.silence_hop_count = 0;
        self.speech_hop_count = 0;
        SpeechSegment {
            samples: segment_samples,
        }
    }
}

/// Soft-knee noise gate: samples below `threshold` are compressed toward
/// zero rather than hard-clipped, matching pluely-master's
/// `apply_noise_gate` (src-tauri/src/speaker/commands.rs:363-378).
fn apply_noise_gate(samples: &[f32], threshold: f32) -> Vec<f32> {
    const KNEE_RATIO: f32 = 3.0;

    if threshold <= 0.0 {
        return samples.to_vec();
    }

    samples
        .iter()
        .map(|&sample| {
            let magnitude = sample.abs();
            if magnitude < threshold {
                sample * (magnitude / threshold).powf(1.0 / KNEE_RATIO)
            } else {
                sample
            }
        })
        .collect()
}

fn calculate_metrics(samples: &[f32]) -> (f32, f32) {
    if samples.is_empty() {
        return (0.0, 0.0);
    }

    let mut sum_sq = 0.0f32;
    let mut peak = 0.0f32;
    for &sample in samples {
        let magnitude = sample.abs();
        peak = peak.max(magnitude);
        sum_sq += sample * sample;
    }

    ((sum_sq / samples.len() as f32).sqrt(), peak)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn silent_hop(len: usize) -> Vec<f32> {
        vec![0.0; len]
    }

    fn loud_hop(len: usize) -> Vec<f32> {
        vec![0.5; len]
    }

    #[test]
    fn discards_short_burst() {
        let config = VadConfig {
            hop_size: 4,
            sensitivity_rms: 0.01,
            peak_threshold: 0.01,
            noise_gate_threshold: 0.0,
            silence_hops: 2,
            min_speech_hops: 3,
            pre_speech_hops: 1,
            max_segment_samples: 1000,
        };
        let mut segmenter = Segmenter::new(config);

        let mut last_event = None;
        for hop in [loud_hop(4), silent_hop(4), silent_hop(4)] {
            for sample in hop {
                let event = segmenter.push(sample);
                if !matches!(event, SegmenterEvent::None) {
                    last_event = Some(event);
                }
            }
        }

        assert!(matches!(last_event, Some(SegmenterEvent::Discarded)));
    }

    #[test]
    fn emits_segment_after_enough_speech_then_silence() {
        let config = VadConfig {
            hop_size: 4,
            sensitivity_rms: 0.01,
            peak_threshold: 0.01,
            noise_gate_threshold: 0.0,
            silence_hops: 2,
            min_speech_hops: 2,
            pre_speech_hops: 1,
            max_segment_samples: 1000,
        };
        let mut segmenter = Segmenter::new(config);

        let mut segment_ready = false;
        for hop in [loud_hop(4), loud_hop(4), silent_hop(4), silent_hop(4)] {
            for sample in hop {
                if let SegmenterEvent::SegmentReady(segment) = segmenter.push(sample) {
                    assert!(!segment.samples.is_empty());
                    segment_ready = true;
                }
            }
        }

        assert!(segment_ready);
    }

    #[test]
    fn force_flushes_at_max_duration() {
        let config = VadConfig {
            hop_size: 2,
            sensitivity_rms: 0.01,
            peak_threshold: 0.01,
            noise_gate_threshold: 0.0,
            silence_hops: 100,
            min_speech_hops: 1,
            pre_speech_hops: 1,
            max_segment_samples: 4,
        };
        let mut segmenter = Segmenter::new(config);

        let mut segment_ready = false;
        for _ in 0..10 {
            if let SegmenterEvent::SegmentReady(_) = segmenter.push(0.5) {
                segment_ready = true;
                break;
            }
        }

        assert!(segment_ready);
    }
}
