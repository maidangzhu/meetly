use anyhow::{anyhow, Result};
use futures_util::StreamExt;
use serde::Serialize;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter};
use tokio::task::JoinHandle;

mod speaker;
mod transcript_buffer;
mod vad;
mod wav;

use transcript_buffer::{TranscriptBuffer, TranscriptSegment};
use vad::{Segmenter, SegmenterEvent, VadConfig};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum AudioRunState {
    Idle,
    Listening,
    SetupRequired,
    Error,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioStatus {
    pub state: AudioRunState,
    pub platform: String,
    pub input_device: Option<String>,
    pub output_device: Option<String>,
    pub sample_rate: Option<u32>,
    pub level: f32,
    pub setup_required: bool,
    pub message: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioLevelChanged {
    pub level: f32,
    pub peak: f32,
    pub rms: f32,
    pub sample_rate: u32,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct TranscriptError {
    message: String,
}

#[derive(Debug, Default)]
struct AudioRuntime {
    task: Option<JoinHandle<()>>,
    sample_rate: Option<u32>,
    level: f32,
    last_error: Option<String>,
}

#[derive(Debug, Default)]
pub struct AudioState {
    runtime: Arc<Mutex<AudioRuntime>>,
    // Kept separate from `AudioRuntime` because it should survive a
    // stop/start cycle: a user pausing and resuming listening should not
    // lose the last few minutes of context.
    transcript: Arc<Mutex<TranscriptBuffer>>,
}

/// Returns transcript segments from the last `window_ms` milliseconds.
/// Called directly (not through Tauri IPC) by other Rust modules, e.g. the
/// future assistant service building an Ask prompt.
pub fn recent_transcript(state: &AudioState, window_ms: u64) -> Vec<TranscriptSegmentDto> {
    let Ok(buffer) = state.transcript.lock() else {
        return Vec::new();
    };
    buffer
        .recent(window_ms)
        .into_iter()
        .map(Into::into)
        .collect()
}

/// Public DTO alias so callers outside this module don't need to reach into
/// the private `transcript_buffer` submodule.
pub type TranscriptSegmentDto = TranscriptSegment;

#[tauri::command]
pub fn get_audio_status(state: tauri::State<AudioState>) -> AudioStatus {
    build_audio_status(&state, None)
}

#[tauri::command]
pub fn get_recent_transcript(
    state: tauri::State<AudioState>,
    window_ms: u64,
) -> Vec<TranscriptSegmentDto> {
    recent_transcript(&state, window_ms)
}

#[tauri::command]
pub async fn start_listening(
    app: AppHandle,
    state: tauri::State<'_, AudioState>,
) -> Result<AudioStatus, String> {
    tracing::info!("start_listening: invoked");

    {
        let runtime = state
            .runtime
            .lock()
            .map_err(|error| format!("Failed to read audio state: {error}"))?;

        if runtime.task.is_some() {
            tracing::info!("start_listening: already listening, no-op");
            return Ok(build_audio_status(&state, Some(AudioRunState::Listening)));
        }
    }

    match start_capture_task(app, state.runtime.clone(), state.transcript.clone()).await {
        Ok(sample_rate) => {
            tracing::info!(sample_rate, "start_listening: capture task started");
            if let Ok(mut runtime) = state.runtime.lock() {
                runtime.sample_rate = Some(sample_rate);
                runtime.last_error = None;
            }

            Ok(build_audio_status(&state, Some(AudioRunState::Listening)))
        }
        Err(error) => {
            let message = error.to_string();
            tracing::error!(%message, "start_listening: failed to start capture task");

            if let Ok(mut runtime) = state.runtime.lock() {
                runtime.task = None;
                runtime.sample_rate = None;
                runtime.level = 0.0;
                runtime.last_error = Some(message.clone());
            }

            Err(message)
        }
    }
}

#[tauri::command]
pub async fn stop_listening(state: tauri::State<'_, AudioState>) -> Result<AudioStatus, String> {
    let task = {
        let mut runtime = state
            .runtime
            .lock()
            .map_err(|error| format!("Failed to update audio state: {error}"))?;

        runtime.level = 0.0;
        runtime.sample_rate = None;
        runtime.task.take()
    };

    if let Some(task) = task {
        task.abort();
        tokio::time::sleep(std::time::Duration::from_millis(250)).await;
    }

    Ok(build_audio_status(&state, Some(AudioRunState::Idle)))
}

async fn start_capture_task(
    app: AppHandle,
    runtime: Arc<Mutex<AudioRuntime>>,
    transcript: Arc<Mutex<TranscriptBuffer>>,
) -> Result<u32> {
    tracing::debug!("start_capture_task: creating SpeakerInput (CoreAudio process tap)");
    let input = speaker::SpeakerInput::new(None).inspect_err(|error| {
        tracing::error!(%error, "start_capture_task: SpeakerInput::new failed");
    })?;

    tracing::debug!("start_capture_task: SpeakerInput created, requesting stream");
    let stream = input.stream().inspect_err(|error| {
        tracing::error!(%error, "start_capture_task: input.stream() failed");
    })?;
    let sample_rate = stream.sample_rate();
    tracing::debug!(sample_rate, "start_capture_task: stream obtained");

    if !(8_000..=96_000).contains(&sample_rate) {
        return Err(anyhow!("Invalid sample rate: {sample_rate}"));
    }

    let runtime_for_task = runtime.clone();
    let app_for_task = app.clone();
    let task = tokio::spawn(async move {
        run_level_capture(
            app_for_task,
            runtime_for_task,
            transcript,
            stream,
            sample_rate,
        )
        .await;
    });

    let mut guard = runtime
        .lock()
        .map_err(|error| anyhow!("Failed to store audio task: {error}"))?;
    guard.task = Some(task);
    guard.sample_rate = Some(sample_rate);
    guard.level = 0.0;
    guard.last_error = None;

    Ok(sample_rate)
}

async fn run_level_capture(
    app: AppHandle,
    runtime: Arc<Mutex<AudioRuntime>>,
    transcript: Arc<Mutex<TranscriptBuffer>>,
    mut stream: speaker::SpeakerStream,
    sample_rate: u32,
) {
    let _ = app.emit("audio_capture_started", sample_rate);

    let hop_size = 1024usize;
    let mut chunk = Vec::with_capacity(hop_size);
    let mut segmenter = Segmenter::new(VadConfig::from_millis(sample_rate));
    let mut elapsed_samples: u64 = 0;

    while let Some(sample) = stream.next().await {
        elapsed_samples += 1;
        chunk.push(sample);

        match segmenter.push(sample) {
            SegmenterEvent::None => {}
            SegmenterEvent::SpeechStarted => {
                let _ = app.emit("speech_segment_started", ());
            }
            SegmenterEvent::Discarded => {}
            SegmenterEvent::SegmentReady(segment) => {
                let end_ms = elapsed_samples * 1000 / sample_rate as u64;
                let start_ms =
                    end_ms.saturating_sub(segment.samples.len() as u64 * 1000 / sample_rate as u64);

                spawn_transcription(
                    app.clone(),
                    transcript.clone(),
                    sample_rate,
                    segment.samples,
                    start_ms,
                    end_ms,
                );
            }
        }

        if chunk.len() < hop_size {
            continue;
        }

        let (rms, peak) = calculate_audio_metrics(&chunk);
        let level = (rms * 8.0).clamp(0.0, 1.0);

        if let Ok(mut guard) = runtime.lock() {
            guard.level = level;
        }

        let _ = app.emit(
            "audio_level_changed",
            AudioLevelChanged {
                level,
                peak,
                rms,
                sample_rate,
            },
        );

        chunk.clear();
    }

    if let Ok(mut guard) = runtime.lock() {
        guard.task = None;
        guard.sample_rate = None;
        guard.level = 0.0;
    }

    let _ = app.emit("audio_capture_stopped", ());
}

/// Transcribes one completed speech segment as an independent task so a
/// slow STT response never blocks the capture loop from processing the
/// next chunk. If `stop_listening` happens while this is in flight, it is
/// not cancelled: it simply emits its result whenever it completes.
fn spawn_transcription(
    app: AppHandle,
    transcript: Arc<Mutex<TranscriptBuffer>>,
    sample_rate: u32,
    samples: Vec<f32>,
    start_ms: u64,
    end_ms: u64,
) {
    tokio::spawn(async move {
        let wav_bytes = match wav::encode_wav(sample_rate, &samples) {
            Ok(bytes) => bytes,
            Err(error) => {
                let _ = app.emit(
                    "transcript_error",
                    TranscriptError {
                        message: format!("Failed to encode speech segment: {error}"),
                    },
                );
                return;
            }
        };

        use crate::providers::stt::SttProvider as _;

        let provider = match crate::providers::stt::build_from_saved_config(&app) {
            Ok(provider) => provider,
            Err(error) => {
                let _ = app.emit(
                    "transcript_error",
                    TranscriptError {
                        message: error.to_string(),
                    },
                );
                return;
            }
        };

        match provider
            .transcribe(wav_bytes, "segment.wav", "audio/wav")
            .await
        {
            Ok(text) => {
                let trimmed = text.trim();
                if trimmed.is_empty() {
                    return;
                }

                let segment = TranscriptSegment {
                    id: uuid_like_id(),
                    source: "system".to_string(),
                    speaker: "interviewer".to_string(),
                    text: trimmed.to_string(),
                    start_ms,
                    end_ms,
                };

                if let Ok(mut buffer) = transcript.lock() {
                    buffer.push(segment.clone());
                }

                let _ = app.emit("transcript_final", segment);
            }
            Err(error) => {
                let _ = app.emit(
                    "transcript_error",
                    TranscriptError {
                        message: error.to_string(),
                    },
                );
            }
        }
    });
}

/// Small dependency-free unique id, sufficient for a per-process transcript
/// segment id (not used for anything security-sensitive or persisted
/// across restarts).
fn uuid_like_id() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or_default();
    format!("seg-{nanos:x}")
}

fn build_audio_status(state: &AudioState, override_state: Option<AudioRunState>) -> AudioStatus {
    let devices = speaker::probe_devices();
    let runtime = state.runtime.lock();
    let (is_listening, sample_rate, level, last_error) = match runtime {
        Ok(guard) => (
            guard.task.is_some(),
            guard.sample_rate,
            guard.level,
            guard.last_error.clone(),
        ),
        Err(error) => (
            false,
            None,
            0.0,
            Some(format!("Failed to read audio state: {error}")),
        ),
    };

    let mut setup_required = devices.output_device.is_none();
    let mut message = devices.error.or(last_error);

    if devices.output_device.is_none() && message.is_none() {
        message = Some("No default output audio device found.".to_string());
    }

    let mut state = if setup_required {
        AudioRunState::SetupRequired
    } else if message.is_some() && !is_listening {
        AudioRunState::Error
    } else if is_listening {
        AudioRunState::Listening
    } else {
        AudioRunState::Idle
    };

    if let Some(next_state) = override_state {
        state = next_state;
        if matches!(state, AudioRunState::Listening) {
            setup_required = false;
        }
    }

    AudioStatus {
        state,
        platform: std::env::consts::OS.to_string(),
        input_device: devices.input_device,
        output_device: devices.output_device,
        sample_rate,
        level,
        setup_required,
        message,
    }
}

fn calculate_audio_metrics(chunk: &[f32]) -> (f32, f32) {
    if chunk.is_empty() {
        return (0.0, 0.0);
    }

    let mut sumsq = 0.0f32;
    let mut peak = 0.0f32;

    for &sample in chunk {
        let abs = sample.abs();
        peak = peak.max(abs);
        sumsq += sample * sample;
    }

    ((sumsq / chunk.len() as f32).sqrt(), peak)
}
