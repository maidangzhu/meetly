# Design: add-system-audio-transcription

## Context

Three architecture decisions were made in conversation with the user before
this design was drafted, superseding parts of `docs/TECHNICAL_DESIGN.md`:

1. **Batch, not streaming.** `docs/TECHNICAL_DESIGN.md` originally specified
   Aliyun real-time WebSocket STT. After reviewing `pluely-master`'s actual
   implementation (`src-tauri/src/speaker/commands.rs`), the user chose the
   simpler Pluely-style flow: VAD detects a complete phrase, encode to WAV,
   one HTTP POST, get text back. Rationale: for a "say a sentence, get
   suggestion fast" meeting-assistant use case, the latency difference
   between batch (silence-wait + one HTTP round trip, ~1-2s with a fast STT
   provider) and streaming (continuous partial results, but a WebSocket
   client, reconnect/backoff, and binary framing to build and maintain) is
   not the bottleneck. Engineering simplicity won.
2. **SiliconFlow, not Aliyun DashScope, as default STT provider.** Aliyun's
   only non-streaming STT path is the recorded-file-transcription REST API,
   which is asynchronous (upload to a public URL, typically OSS, then submit
   a task and poll for completion) — a mismatch with the "one POST, get text
   back" shape this design needs. SiliconFlow exposes an OpenAI-Whisper-
   compatible `/v1/audio/transcriptions` endpoint: upload the file, get
   `{"text": "..."}` back synchronously, matching Pluely's flow exactly with
   no extra infra.
3. **Fixed structured provider fields, not Pluely's curl-template BYOK.**
   Pluely lets users paste an arbitrary curl command with `{{VARIABLE}}`
   placeholders, parsed at runtime (`curl2Json`). This is flexible but adds a
   curl-parsing dependency and a lot of frontend logic for a benefit (support
   for STT providers with a non-OpenAI-compatible shape) this project does
   not need. Meetly fixes the request shape to OpenAI-Whisper-compatible and
   only lets the user override `base_url`, `model`, `api_key` — see
   `add-provider-settings`.

## Goals / Non-Goals

Goals:
- Turn continuous system-audio PCM into discrete transcript segments.
- Keep latency low enough for "say a sentence, get a suggestion" (target:
  under 2s from end-of-speech to transcript text, assuming a fast STT
  provider — this is a soft target, not a hard SLA, since it depends on
  network and provider load).
- Reuse the existing `audio::speaker` capture module unchanged.

Non-goals:
- Real-time partial transcripts.
- Speaker diarization.
- Persisting audio or transcript to disk.

## Decisions

### VAD parameters (unchanged from docs/TECHNICAL_DESIGN.md section 4.4)

```rust
const MIN_SPEECH_MS: u32 = 300;
const END_SILENCE_MS: u32 = 700;
const MAX_SEGMENT_MS: u32 = 15_000;
const PRE_ROLL_MS: u32 = 300;
```

Implementation follows `pluely-master`'s `run_vad_capture` pattern
(`src-tauri/src/speaker/commands.rs:135-257`): hop-size chunking, a noise
gate before RMS/peak comparison, a rolling pre-speech buffer so the start of
a phrase isn't clipped, and a 30-second safety cap that force-flushes a
segment (Meetly uses 15s per `MAX_SEGMENT_MS` above, tighter than Pluely's
30s, to keep suggestion latency down during long uninterrupted speech).

```rust
pub struct VadConfig {
    pub hop_size: usize,          // 1024 samples per analysis chunk
    pub sensitivity_rms: f32,     // 0.012
    pub peak_threshold: f32,      // 0.035
    pub silence_chunks: u32,      // derived from END_SILENCE_MS / hop duration
    pub min_speech_chunks: u32,   // derived from MIN_SPEECH_MS / hop duration
    pub pre_speech_chunks: u32,   // derived from PRE_ROLL_MS / hop duration
    pub noise_gate_threshold: f32,// 0.003
}
```

### Module layout

```text
src-tauri/src/audio/
  mod.rs              (existing: AudioState, start_listening/stop_listening)
  speaker/            (existing: unchanged, Core Audio Process Tap capture)
  vad.rs              (new: energy-threshold segmenter, ports Pluely's algorithm)
  transcript_buffer.rs(new: rolling 3-minute segment history)
providers/
  stt/
    mod.rs            (new: SttProvider trait)
    openai_compatible.rs (new: multipart POST, OpenAI-Whisper response shape)
```

### VAD -> WAV -> HTTP flow

```text
speaker PCM stream (f32, existing)
  -> vad::segment() chunks into hop_size windows
  -> energy gate decides speech/silence
  -> on segment end: samples_to_wav(sample_rate, &segment) -> Vec<u8>
  -> providers::stt::openai_compatible::transcribe(wav_bytes) -> String
  -> transcript_buffer::push(TranscriptSegment { text, start_ms, end_ms })
  -> app.emit("transcript_final", segment)
```

WAV encoding reuses the `hound` crate (already a dependency choice validated
by `pluely-master`; not yet in this project's `Cargo.toml`, must be added).
16-bit signed PCM, mono, sample rate taken from the live stream (matches
`pluely-master`'s `samples_to_wav_b64`, `src-tauri/src/speaker/commands.rs:421-459`,
minus the base64 step since Meetly sends raw multipart bytes instead of a
base64 Tauri event payload).

### STT provider trait

```rust
#[async_trait::async_trait]
pub trait SttProvider: Send + Sync {
    async fn transcribe(&self, wav_bytes: Vec<u8>) -> anyhow::Result<String>;
}

pub struct OpenAiCompatibleStt {
    base_url: String,
    model: String,
    api_key: String, // read from keyring at call time, not stored on this struct long-term
}

impl SttProvider for OpenAiCompatibleStt {
    async fn transcribe(&self, wav_bytes: Vec<u8>) -> anyhow::Result<String> {
        let form = reqwest::multipart::Form::new()
            .text("model", self.model.clone())
            .part("file", reqwest::multipart::Part::bytes(wav_bytes)
                .file_name("segment.wav")
                .mime_str("audio/wav")?);

        let resp = self.client
            .post(&self.base_url)
            .bearer_auth(&self.api_key)
            .multipart(form)
            .send()
            .await?;

        if !resp.status().is_success() {
            let body = resp.text().await.unwrap_or_default();
            anyhow::bail!("STT request failed: {} {}", resp.status(), body);
        }

        #[derive(serde::Deserialize)]
        struct SttResponse { text: String }
        let parsed: SttResponse = resp.json().await?;
        Ok(parsed.text)
    }
}
```

Default config (from `add-provider-settings`):
`base_url = "https://api.siliconflow.cn/v1/audio/transcriptions"`,
`model = "FunAudioLLM/SenseVoiceSmall"`.

This adds a new dependency: `reqwest` (with `multipart` and `json`
features). Not previously in `Cargo.toml`.

### Transcript buffer

```rust
pub struct TranscriptSegment {
    pub id: String,
    pub text: String,
    pub start_ms: u64,
    pub end_ms: u64,
}

pub struct TranscriptBuffer {
    segments: VecDeque<TranscriptSegment>,
    max_age_ms: u64, // 180_000 (3 minutes)
}

impl TranscriptBuffer {
    pub fn push(&mut self, segment: TranscriptSegment) {
        self.segments.push_back(segment);
        self.evict_older_than(self.max_age_ms);
    }

    pub fn recent(&self, window_ms: u64) -> Vec<&TranscriptSegment> {
        // used by add-llm-suggestions to pull last 90s (Ask) or 180s (screenshot)
    }
}
```

Held in `AudioState` (extends the existing struct in
`src-tauri/src/audio/mod.rs`) behind the same `Arc<Mutex<...>>` pattern
already used for `AudioRuntime`.

### Concurrency

The existing `run_level_capture` task (in `src-tauri/src/audio/mod.rs`) is
extended, not replaced: the same `tokio::spawn`'d loop that currently only
computes RMS/peak for the level meter now also feeds `vad::Segmenter`. On
segment completion, transcription is spawned as its own
`tokio::spawn(async move { ... })` so a slow STT response never blocks the
audio capture loop from processing the next chunk. If `stop_listening` is
called while a transcription is in flight, the in-flight request is not
cancelled (it is not holding the audio capture task open) — it simply emits
its `transcript_final` or `transcript_error` event when it completes, even
after `is_listening` has gone false. The frontend ignores late
`transcript_final` events if the toolbar has already returned to idle.

### Error handling

| Failure | Behavior |
|---|---|
| Network error / timeout | Emit `transcript_error` with a short message. Do not stop the audio capture loop. Log the error without the API key. |
| STT returns non-2xx | Same as above; include the HTTP status in the message, not the full response body if it might contain echoed request data. |
| Empty/whitespace-only text | Discard silently, do not emit `transcript_final`. Matches Pluely's `speech-discarded` behavior for too-short audio. |
| No API key configured | `start_listening` still succeeds (level meter works), but VAD segments that complete emit `transcript_error` with "STT not configured" until the user saves a key in Settings. |

## Risks / Trade-offs

- Batch transcription means the user sees text only after they stop
  speaking (silence-triggered), not while speaking. Accepted per user
  decision above.
- A very talkative speaker who never pauses for 700ms will hit the 15s
  `MAX_SEGMENT_MS` cap repeatedly, producing several shorter segments rather
  than one clean phrase. This matches Pluely's behavior for the 30s cap and
  is an accepted trade-off, not a bug to fix in this change.
- Adding `reqwest` and `hound` as new dependencies. Both are widely used,
  actively maintained crates; `reqwest` in particular will also be reused by
  `add-llm-suggestions` for the chat completions call, so this is not
  STT-only cost.

## Migration Plan

New capability, no migration. Requires `add-provider-settings` to land first
so `get_provider_config`/API key lookup have something to read.

## Open Questions

None outstanding — batch vs streaming and provider choice were resolved in
conversation before drafting.
