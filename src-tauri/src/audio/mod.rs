use anyhow::{anyhow, Result};
use futures_util::StreamExt;
use serde::Serialize;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Instant;
use tauri::{AppHandle, Emitter};
use tokio::task::JoinHandle;

#[cfg(target_os = "macos")]
mod microphone;
mod speaker;
mod transcript_buffer;
mod vad;
pub(crate) mod wav;

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
    pub source: String,
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

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureChannelStatus {
    pub ready: bool,
    pub sample_rate: Option<u32>,
    pub device_name: Option<String>,
    pub message: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MeetingCaptureStatus {
    pub remote: bool,
    pub system: CaptureChannelStatus,
    pub microphone: CaptureChannelStatus,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct AudioChannelFailure {
    source: String,
    message: String,
}

#[derive(Debug, Default)]
struct AudioRuntime {
    task: Option<JoinHandle<()>>,
    stop_signal: Option<Arc<AtomicBool>>,
    sample_rate: Option<u32>,
    device_name: Option<String>,
    level: f32,
    last_error: Option<String>,
}

#[derive(Debug, Default)]
pub struct AudioState {
    runtime: Arc<Mutex<AudioRuntime>>,
    microphone_runtime: Arc<Mutex<AudioRuntime>>,
    // Kept separate from `AudioRuntime` because it should survive a
    // stop/start cycle: a user pausing and resuming listening should not
    // lose the last few minutes of context.
    transcript: Arc<Mutex<TranscriptBuffer>>,
}

#[derive(Clone, Copy)]
enum CaptureChannel {
    System,
    Microphone,
}

impl CaptureChannel {
    fn source(self) -> &'static str {
        match self {
            Self::System => "system",
            Self::Microphone => "microphone",
        }
    }

    fn speaker(self) -> &'static str {
        match self {
            Self::System => "interviewer",
            Self::Microphone => "user",
        }
    }
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

pub fn is_listening(state: &AudioState) -> bool {
    state
        .runtime
        .lock()
        .map(|runtime| runtime.task.is_some())
        .unwrap_or(false)
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

    match start_system_capture_task(
        app,
        state.runtime.clone(),
        state.transcript.clone(),
        Instant::now(),
    )
    .await
    {
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
pub async fn start_meeting_capture(
    app: AppHandle,
    state: tauri::State<'_, AudioState>,
    remote: bool,
) -> Result<MeetingCaptureStatus, String> {
    tracing::info!(remote, "start_meeting_capture: invoked");
    let started_at = Instant::now();

    let system = if remote {
        start_system_channel(
            app.clone(),
            state.runtime.clone(),
            state.transcript.clone(),
            started_at,
        )
        .await
    } else {
        stop_runtime(state.runtime.clone()).await?;
        CaptureChannelStatus {
            ready: false,
            sample_rate: None,
            device_name: None,
            message: None,
        }
    };

    let microphone = start_microphone_channel(
        app.clone(),
        state.microphone_runtime.clone(),
        state.transcript.clone(),
        started_at,
    )
    .await;

    for (channel, status) in [
        (CaptureChannel::System, &system),
        (CaptureChannel::Microphone, &microphone),
    ] {
        if let Some(message) = status.message.as_ref().filter(|_| !status.ready) {
            let _ = app.emit(
                "audio_channel_failed",
                AudioChannelFailure {
                    source: channel.source().to_string(),
                    message: message.clone(),
                },
            );
        }
    }

    Ok(MeetingCaptureStatus {
        remote,
        system,
        microphone,
    })
}

#[tauri::command]
pub async fn stop_listening(state: tauri::State<'_, AudioState>) -> Result<AudioStatus, String> {
    stop_runtime(state.runtime.clone()).await?;

    Ok(build_audio_status(&state, Some(AudioRunState::Idle)))
}

#[tauri::command]
pub async fn stop_meeting_capture(
    state: tauri::State<'_, AudioState>,
) -> Result<MeetingCaptureStatus, String> {
    stop_runtime(state.runtime.clone()).await?;
    stop_runtime(state.microphone_runtime.clone()).await?;
    Ok(MeetingCaptureStatus {
        remote: false,
        system: idle_channel_status(),
        microphone: idle_channel_status(),
    })
}

async fn stop_runtime(runtime: Arc<Mutex<AudioRuntime>>) -> Result<(), String> {
    let task = {
        let mut runtime = runtime
            .lock()
            .map_err(|error| format!("Failed to update audio state: {error}"))?;
        runtime.level = 0.0;
        runtime.sample_rate = None;
        runtime.device_name = None;
        if let Some(stop_signal) = runtime.stop_signal.take() {
            stop_signal.store(true, Ordering::Release);
        }
        runtime.task.take()
    };

    if let Some(task) = task {
        task.abort();
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;
    }
    Ok(())
}

fn idle_channel_status() -> CaptureChannelStatus {
    CaptureChannelStatus {
        ready: false,
        sample_rate: None,
        device_name: None,
        message: None,
    }
}

fn current_channel_status(runtime: &Arc<Mutex<AudioRuntime>>) -> Option<CaptureChannelStatus> {
    let runtime = runtime.lock().ok()?;
    runtime.task.as_ref()?;
    Some(CaptureChannelStatus {
        ready: true,
        sample_rate: runtime.sample_rate,
        device_name: runtime.device_name.clone(),
        message: None,
    })
}

async fn start_system_channel(
    app: AppHandle,
    runtime: Arc<Mutex<AudioRuntime>>,
    transcript: Arc<Mutex<TranscriptBuffer>>,
    started_at: Instant,
) -> CaptureChannelStatus {
    if let Some(status) = current_channel_status(&runtime) {
        return status;
    }

    match start_system_capture_task(app, runtime, transcript, started_at).await {
        Ok(sample_rate) => CaptureChannelStatus {
            ready: true,
            sample_rate: Some(sample_rate),
            device_name: speaker::probe_devices().output_device,
            message: None,
        },
        Err(error) => CaptureChannelStatus {
            ready: false,
            sample_rate: None,
            device_name: None,
            message: Some(error.to_string()),
        },
    }
}

async fn start_microphone_channel(
    app: AppHandle,
    runtime: Arc<Mutex<AudioRuntime>>,
    transcript: Arc<Mutex<TranscriptBuffer>>,
    started_at: Instant,
) -> CaptureChannelStatus {
    if let Some(status) = current_channel_status(&runtime) {
        return status;
    }

    #[cfg(target_os = "macos")]
    {
        match start_microphone_capture_task(app, runtime, transcript, started_at).await {
            Ok((sample_rate, device_name)) => CaptureChannelStatus {
                ready: true,
                sample_rate: Some(sample_rate),
                device_name: Some(device_name),
                message: None,
            },
            Err(error) => CaptureChannelStatus {
                ready: false,
                sample_rate: None,
                device_name: None,
                message: Some(error.to_string()),
            },
        }
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = (app, runtime, transcript, started_at);
        CaptureChannelStatus {
            ready: false,
            sample_rate: None,
            device_name: None,
            message: Some(
                "Native microphone meeting capture is only implemented on macOS.".to_string(),
            ),
        }
    }
}

async fn start_system_capture_task(
    app: AppHandle,
    runtime: Arc<Mutex<AudioRuntime>>,
    transcript: Arc<Mutex<TranscriptBuffer>>,
    started_at: Instant,
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
            CaptureChannel::System,
            started_at,
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

#[cfg(target_os = "macos")]
async fn start_microphone_capture_task(
    app: AppHandle,
    runtime: Arc<Mutex<AudioRuntime>>,
    transcript: Arc<Mutex<TranscriptBuffer>>,
    started_at: Instant,
) -> Result<(u32, String)> {
    let (ready_tx, ready_rx) = tokio::sync::oneshot::channel();
    let stop_signal = Arc::new(AtomicBool::new(false));
    let stop_for_task = stop_signal.clone();
    let runtime_for_task = runtime.clone();
    let task = tokio::task::spawn_blocking(move || {
        let mut stream = match microphone::MicrophoneStream::new() {
            Ok(stream) => stream,
            Err(error) => {
                let _ = ready_tx.send(Err(error.to_string()));
                return;
            }
        };
        let sample_rate = stream.sample_rate();
        let device_name = stream.device_name().to_string();
        let _ = ready_tx.send(Ok((sample_rate, device_name)));
        run_microphone_capture_blocking(
            app,
            runtime_for_task,
            transcript,
            &mut stream,
            sample_rate,
            started_at,
            stop_for_task,
        );
    });

    let (sample_rate, device_name) = ready_rx
        .await
        .map_err(|_| anyhow!("Native microphone task stopped during startup"))?
        .map_err(anyhow::Error::msg)?;

    let mut guard = runtime
        .lock()
        .map_err(|error| anyhow!("Failed to store microphone task: {error}"))?;
    guard.task = Some(task);
    guard.stop_signal = Some(stop_signal);
    guard.sample_rate = Some(sample_rate);
    guard.device_name = Some(device_name.clone());
    guard.level = 0.0;
    guard.last_error = None;
    Ok((sample_rate, device_name))
}

#[cfg(target_os = "macos")]
fn run_microphone_capture_blocking(
    app: AppHandle,
    runtime: Arc<Mutex<AudioRuntime>>,
    transcript: Arc<Mutex<TranscriptBuffer>>,
    stream: &mut microphone::MicrophoneStream,
    sample_rate: u32,
    started_at: Instant,
    stop_signal: Arc<AtomicBool>,
) {
    let channel = CaptureChannel::Microphone;
    let _ = app.emit("audio_channel_started", channel.source());
    let mut segmenter = Segmenter::new(VadConfig::from_millis(sample_rate));
    let mut samples = vec![0.0f32; 2_048];
    let mut level_chunk = Vec::with_capacity(2_048);

    while !stop_signal.load(Ordering::Acquire) {
        let count = stream.read_samples(&mut samples);
        if count == 0 {
            std::thread::sleep(std::time::Duration::from_millis(5));
            continue;
        }

        for &sample in &samples[..count] {
            level_chunk.push(sample);
            match segmenter.push(sample) {
                SegmenterEvent::None => {}
                SegmenterEvent::SpeechStarted => {
                    let _ = app.emit("speech_segment_started", channel.source());
                }
                SegmenterEvent::Discarded => {}
                SegmenterEvent::SegmentReady(segment) => {
                    let end_ms = started_at.elapsed().as_millis() as u64;
                    let start_ms = end_ms
                        .saturating_sub(segment.samples.len() as u64 * 1000 / sample_rate as u64);
                    spawn_transcription(
                        app.clone(),
                        transcript.clone(),
                        sample_rate,
                        segment.samples,
                        start_ms,
                        end_ms,
                        channel,
                    );
                }
            }
        }

        if level_chunk.len() >= 1_024 {
            let (rms, peak) = calculate_audio_metrics(&level_chunk);
            let level = (rms * 8.0).clamp(0.0, 1.0);
            if let Ok(mut guard) = runtime.lock() {
                guard.level = level;
            }
            let _ = app.emit(
                "audio_level_changed",
                AudioLevelChanged {
                    source: channel.source().to_string(),
                    level,
                    peak,
                    rms,
                    sample_rate,
                },
            );
            level_chunk.clear();
        }
    }

    if let Ok(mut guard) = runtime.lock() {
        guard.task = None;
        guard.stop_signal = None;
        guard.sample_rate = None;
        guard.device_name = None;
        guard.level = 0.0;
    }
    let _ = app.emit("audio_channel_stopped", channel.source());
}

async fn run_level_capture<S>(
    app: AppHandle,
    runtime: Arc<Mutex<AudioRuntime>>,
    transcript: Arc<Mutex<TranscriptBuffer>>,
    mut stream: S,
    sample_rate: u32,
    channel: CaptureChannel,
    started_at: Instant,
) where
    S: futures_util::Stream<Item = f32> + Unpin,
{
    let _ = app.emit("audio_channel_started", channel.source());
    if matches!(channel, CaptureChannel::System) {
        let _ = app.emit("audio_capture_started", sample_rate);
    }

    let hop_size = 1024usize;
    let mut chunk = Vec::with_capacity(hop_size);
    let mut segmenter = Segmenter::new(VadConfig::from_millis(sample_rate));

    while let Some(sample) = stream.next().await {
        chunk.push(sample);

        match segmenter.push(sample) {
            SegmenterEvent::None => {}
            SegmenterEvent::SpeechStarted => {
                let _ = app.emit("speech_segment_started", ());
            }
            SegmenterEvent::Discarded => {}
            SegmenterEvent::SegmentReady(segment) => {
                let end_ms = started_at.elapsed().as_millis() as u64;
                let start_ms =
                    end_ms.saturating_sub(segment.samples.len() as u64 * 1000 / sample_rate as u64);

                spawn_transcription(
                    app.clone(),
                    transcript.clone(),
                    sample_rate,
                    segment.samples,
                    start_ms,
                    end_ms,
                    channel,
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
                source: channel.source().to_string(),
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

    let _ = app.emit("audio_channel_stopped", channel.source());
    if matches!(channel, CaptureChannel::System) {
        let _ = app.emit("audio_capture_stopped", ());
    }
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
    channel: CaptureChannel,
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
            .transcribe(crate::providers::stt::BatchAsrRequest::new(
                wav_bytes,
                "segment.wav",
                "audio/wav",
            ))
            .await
        {
            Ok(text) => {
                let trimmed = text.trim();
                if trimmed.is_empty() {
                    return;
                }

                let segment = TranscriptSegment {
                    id: uuid_like_id(),
                    source: channel.source().to_string(),
                    speaker: channel.speaker().to_string(),
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
