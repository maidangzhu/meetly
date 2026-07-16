# Voice Dictation Runtime Design

Date: 2026-07-16
Status: Proposed
Related baseline: `openspec/changes/add-voice-dictation`
Implementation change: `openspec/changes/stabilize-voice-dictation-runtime`

## 1. Decision

Meetly will keep Voice Dictation as a workflow separate from Voice Ask,
Meeting/Interview, Coach, and the proactive Agent runtime.

The durable Dictation pipeline will be coordinated by one Rust-owned session
state machine. React will render events and send user intents, but it will not
decide the authoritative order of recording, transcription, polish, and text
delivery.

Both ASR and LLM integrations are first-class provider extension points. The
first implementation may enable only the providers already configured in
Meetly, but provider capabilities, errors, timeouts, and configuration are part
of the runtime contract from the start.

The shared registry, profile, credential, and cross-workflow boundaries are
defined in [`PROVIDER_ARCHITECTURE.md`](./PROVIDER_ARCHITECTURE.md).

```text
ShortcutController
        |
        v
DictationCoordinator (authoritative session state)
        |
        +-> AudioRecorder -> AsrProvider
        +-> PolishService -> LlmProvider
        +-> DeliveryService -> clipboard / Cmd+V
        |
        v
DictationEvent stream -> React voice overlay
```

This is a bounded refactor, not a rewrite of Meeting audio or the TypeScript
Agent runtime.

## 2. Why the Current Boundary Is Fragile

The current vertical slice proved the product interaction, but a single run is
split across several owners:

- Rust owns shortcut activation, the active run lease, target capture, and
  native output commands.
- React owns `MediaRecorder`, phase transitions, STT invocation, polish
  invocation, delivery invocation, retry, and terminal UI timing.
- The overlay window owns another visible lifecycle.
- Provider adapters report transport errors without a Dictation-specific stage
  or fallback contract.

That split allows valid text to exist in the clipboard while the UI still
shows failure. It also makes cancellation and stale asynchronous results depend
on several refs and reducers agreeing with the Rust active run.

The runtime needs one authoritative session model and explicit stage outcomes.

## 3. Reference Findings From OpenLess

The local OpenLess source at `~/maidang/openless` provides a useful production
reference. Meetly should copy the boundaries, not the full feature volume.

### 3.1 Recording and ASR

OpenLess records in Rust with `cpal` and normalizes all microphone input to
16 kHz, mono, signed 16-bit little-endian PCM. The recorder owns downmixing,
resampling, RMS level events, stream lifecycle, and a liveness watchdog.

Its ASR boundary accepts normalized PCM and supports two execution models:

- streaming providers consume PCM while recording and return partial/final
  events;
- batch providers buffer PCM, encode WAV after stop, and make one or more HTTP
  requests.

Additional reliability behavior includes:

- session IDs attached to recorder and ASR resources;
- startup/stop race handling;
- cancellation racing in-flight transcription;
- optional WAV archive for retry and diagnostics;
- dynamic timeout derived from audio duration;
- provider-aware chunk limits and CJK-aware transcript joining;
- Whisper prompt injection for user vocabulary;
- optional verbose metadata filtering for obvious hallucinated segments;
- automatic retry from archived audio before declaring transcription failure.

Meetly currently records compressed MP4/WebM audio in the WebView, converts the
blob to base64, and sends a complete clip to a batch-only STT trait. This is a
reasonable MVP path but not the durable background Dictation boundary.

### 3.2 Polish

OpenLess treats polish as an optional transformation of a successful
transcript:

- request timeout defaults to 30 seconds;
- HTTP clients are reused;
- only transient connection/request failures are retried;
- timeouts are not automatically retried because the provider may already be
  processing or billing the request;
- provider-specific thinking controls are applied;
- raw transcript is wrapped as untrusted data rather than concatenated as an
  instruction;
- working language, frontmost app, vocabulary, and a small recent-history
  window can be included;
- common reasoning blocks, Markdown fences, and boilerplate prefixes are
  removed;
- any polish failure returns the raw transcript with diagnostic metadata.

Meetly currently uses one prompt, an eight-second outer timeout, and minimal
output cleaning. Logs show a real request reaching that exact timeout. The
short budget and the lack of a provider-specific policy are reliability risks.

### 3.3 Delivery

On macOS, OpenLess relies on a non-activating panel preserving the external
application focus. It writes the result to the clipboard and posts `Cmd+V`.
Failure to simulate paste becomes a copied fallback, not a failed Dictation
run.

Meetly should not require restoration of an Accessibility focused-element
handle before sending paste. Accessibility remains useful for reading selected
text in Voice Ask, but it is not a reliable prerequisite for Dictation output.

### 3.4 What Not to Copy Yet

Meetly should not initially copy OpenLess's complete provider catalog, local
model downloaders, Style Pack marketplace, translation modes, or per-token
keyboard insertion. Those features add large operational and testing surfaces
without resolving the current state and delivery semantics.

## 4. Target State Machine

```text
Idle
  -> Starting
  -> Recording
  -> Transcribing
  -> Polishing
  -> Delivering
  -> Completed

Starting | Recording | Transcribing | Polishing | Delivering
  -> Cancelling
  -> Idle

Starting | Recording | Transcribing | Polishing | Delivering
  -> Failed(stage, retryability, recoverable_text)
```

The coordinator owns every transition. UI phases are projections of the
coordinator state, not an independent workflow.

### 4.1 Session Identity

Every run uses a UUID `session_id`. Recorder callbacks, provider results,
cancel requests, polish results, delivery results, and UI events carry the same
ID. A continuation with a stale ID is discarded without mutating the current
session.

### 4.2 Stage Outcomes

```rust
enum AsrOutcome {
    Transcript(Transcript),
    Empty,
    Failed(ProviderFailure),
}

enum PolishOutcome {
    Polished(String),
    RawFallback { raw: String, reason: ProviderFailure },
    Skipped(String),
}

enum DeliveryOutcome {
    Pasted,
    Copied { reason: CopyFallbackReason },
    Failed(DeliveryFailure),
}
```

Semantic rules:

- successful STT is recoverable user value;
- polish failure is not a failed run when raw text exists;
- `Copied` is a successful terminal outcome with reduced automation;
- only failure to preserve the final text in the clipboard is a terminal
  delivery failure;
- retrying paste reuses final text and does not rerun ASR or LLM polish.

## 5. Audio Boundary

### 5.1 Canonical Format

The native recorder will expose one canonical format:

```rust
struct PcmChunk {
    session_id: Uuid,
    samples: Arc<[i16]>,
    sample_rate_hz: u32, // 16_000
    channels: u16,       // 1
    captured_at_ms: u64,
}
```

Input-device sample formats and channel counts are converted at the recorder
boundary. Provider adapters never need to understand WebM, MP4, microphone
device layouts, or WebView blobs.

For the migration period, the existing `MediaRecorder` path remains behind an
`AudioArtifact` adapter so provider and state work can land before native audio
capture.

### 5.2 Recording Archive

Successful runs do not need permanent audio by default. The runtime may keep a
temporary private WAV artifact until the run reaches a terminal state.

- Delete after successful transcription unless diagnostics/history retention
  is explicitly enabled.
- Keep after ASR failure long enough for automatic or manual retry.
- Store with restrictive filesystem permissions.
- Never log audio contents.

## 6. ASR Provider Architecture

ASR providers declare capabilities instead of forcing every provider through
one streaming-shaped or batch-shaped API.

```rust
enum AsrMode {
    Batch,
    Streaming,
}

struct AsrCapabilities {
    mode: AsrMode,
    accepted_audio: &'static [AudioEncoding],
    supports_partial: bool,
    supports_hotwords: bool,
    supports_language_hint: bool,
    supports_verbose_segments: bool,
    max_audio_duration_ms: Option<u64>,
}

#[async_trait::async_trait]
trait AsrProvider: Send + Sync {
    fn id(&self) -> &'static str;
    fn capabilities(&self) -> AsrCapabilities;
    async fn transcribe_batch(
        &self,
        request: BatchAsrRequest,
        cancel: CancellationToken,
    ) -> Result<Transcript, ProviderFailure>;
    async fn start_stream(
        &self,
        request: StreamingAsrRequest,
        cancel: CancellationToken,
    ) -> Result<Box<dyn AsrStream>, ProviderFailure>;
}
```

Providers may return `unsupported` for the mode they do not implement. The
registry selects a provider using saved configuration and validates required
credentials before recording starts when possible.

Initial adapters:

- existing OpenAI-compatible Whisper batch endpoint;
- existing meeting realtime provider only after its microphone/session
  semantics are explicitly adapted, not reused implicitly.

Planned adapters may include Volcengine, Alibaba/Qwen realtime, Groq/OpenAI
Whisper-compatible endpoints, and local ASR. Adding them must not change the
coordinator state machine or UI event vocabulary.

## 7. LLM Provider Architecture

Dictation polish uses the shared LLM provider registry through a dedicated
plain-text application contract.

```rust
struct LlmCapabilities {
    supports_streaming: bool,
    thinking_control: ThinkingControl,
    max_output_tokens: Option<u32>,
}

#[async_trait::async_trait]
trait LlmProvider: Send + Sync {
    fn id(&self) -> &'static str;
    fn capabilities(&self) -> LlmCapabilities;
    async fn complete_text(
        &self,
        request: TextCompletionRequest,
        cancel: CancellationToken,
    ) -> Result<String, ProviderFailure>;
}
```

Provider-specific behavior belongs in adapters:

- endpoint/body shape;
- authentication and extra headers;
- thinking/reasoning controls;
- streaming event parsing;
- timeout defaults and retry eligibility;
- response extraction and provider error classification.

Dictation-specific behavior belongs in `PolishService`:

- prompt composition;
- raw transcript envelope and injection defense;
- language, app, vocabulary, and bounded-history context;
- output cleaning;
- raw fallback.

The first stable polish path remains non-streaming. Streaming polish can be
added later without changing the provider registry or fallback semantics.

## 8. Provider Configuration and Errors

Provider IDs, model IDs, endpoints, and non-secret options are stored in app
configuration. API keys and tokens remain in the secure credential boundary.
The UI selects an active ASR provider and active LLM provider independently.

```rust
enum ProviderFailureKind {
    MissingCredentials,
    Authentication,
    Permission,
    RateLimited,
    InvalidRequest,
    UnsupportedCapability,
    Connect,
    Timeout,
    ServiceUnavailable,
    InvalidResponse,
    Cancelled,
    Internal,
}

struct ProviderFailure {
    provider_id: String,
    kind: ProviderFailureKind,
    retryable: bool,
    user_message: String,
    diagnostic_code: Option<String>,
}
```

Provider errors must remain visible in diagnostics and logs without exposing
API keys, Authorization headers, or full private transcripts.

## 9. Polish Contract

The default Light polish mode will:

- preserve language, meaning, perspective, tone, names, numbers, URLs, code,
  paths, variables, product names, versions, and domain terms;
- remove meaningless fillers, false starts, and obvious repetition;
- repair punctuation and small grammar/order issues;
- remain close to the source length;
- not answer questions, execute spoken commands, invent facts, or expand ideas;
- return plain text only.

The raw transcript is placed in a bounded `<raw_transcript>` envelope and
treated as untrusted data. Model output is cleaned for reasoning blocks,
Markdown fences, and known boilerplate.

Default timeout should be provider-aware with a 30-second upper budget for
cloud polish. A timeout falls back to raw text. Automatic retry is limited to
failures known to occur before the provider accepted the request.

## 10. Delivery Contract

The macOS overlay remains non-activating. The runtime captures frontmost app
identity when Dictation starts, primarily for validation and optional app-level
activation.

Delivery order:

1. Confirm the session is still current.
2. Write final text to the clipboard.
3. If auto-paste is disabled, finish as `Copied`.
4. If the original app is still the target, post `Cmd+V` directly.
5. If focus moved, optionally activate the captured app and then post `Cmd+V`.
6. If paste cannot be attempted safely, keep the final text and finish as
   `Copied`.
7. Restore the previous clipboard only after a successful paste and only when
   policy allows it.

Restoring an Accessibility focused-element handle is best effort and must not
be a prerequisite for app-level paste. Dictation never sends Enter.

## 11. UI Event Contract

Rust emits serializable snapshots or events:

```ts
type DictationSnapshot = {
  sessionId: string | null;
  phase: "idle" | "starting" | "recording" | "transcribing" |
    "polishing" | "delivering" | "completed" | "failed";
  audioLevel: number;
  message: string | null;
  finalTextAvailable: boolean;
  delivery: "pasted" | "copied" | null;
  failure: {
    stage: "recording" | "asr" | "polish" | "delivery";
    retryable: boolean;
    code: string | null;
  } | null;
};
```

React renders the snapshot and emits intents such as cancel, stop recording,
retry delivery, or dismiss. React does not infer success from low-level booleans.

## 12. Migration Plan

### Step 1: Contracts and current bug semantics

- Introduce explicit delivery outcomes.
- Treat copied fallback as successful completion.
- Do not require AX focused-element restoration before `Cmd+V`.
- Add stage-aware logs and tests.

### Step 2: Rust coordinator

- Add the authoritative state machine and UUID session IDs.
- Move STT, polish, delivery ordering, cancellation, and retry decisions into
  Rust.
- Keep the existing WebView recorder behind a temporary audio-artifact bridge.

### Step 3: Provider registry hardening

- Add ASR and LLM capability declarations.
- Normalize provider failures and diagnostics.
- Add provider contract tests and independent active-provider settings.
- Keep the existing configured providers as the first adapters.

### Step 4: Native microphone recorder

- Add `cpal` capture, canonical PCM conversion, audio-level events, watchdog,
  and temporary WAV archive.
- Remove Blob/base64 transfer from Dictation.

### Step 5: Reliability features

- Add dynamic ASR timeout, archived-audio retry, vocabulary hints, long-audio
  chunking, and supported hallucination filtering.
- Evaluate streaming ASR providers behind the same capability contract.

Each step is implemented, verified, and approved separately.

## 13. Verification Matrix

Automated:

- pure coordinator transition tests;
- pending stop and stale continuation tests;
- cancel at every stage;
- provider capability and error mapping tests;
- polish raw fallback tests;
- pasted/copied/failed delivery classification tests;
- retry delivery without rerunning ASR/LLM;
- existing Voice Ask and Meeting regression tests.

Manual macOS:

- TextEdit;
- Safari/Chrome text input and textarea;
- VS Code editor;
- Terminal;
- Feishu chat input;
- app switch during processing;
- target app closed;
- Accessibility denied;
- built-in, Bluetooth, and USB microphones;
- active Meeting remains blocked until coexistence is explicitly validated.
