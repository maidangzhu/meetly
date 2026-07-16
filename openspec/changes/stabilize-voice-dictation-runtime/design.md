# Design: stabilize-voice-dictation-runtime

## 1. Architecture Decision

Voice Dictation becomes a Rust-coordinated transaction:

```text
native shortcut
  -> DictationCoordinator
  -> AudioRecorder
  -> selected AsrProvider
  -> PolishService using selected LlmProvider
  -> DeliveryService
  -> DictationSnapshot events
  -> React voice overlay
```

Rust owns the session state, cancellation, provider invocation order, fallback
decisions, target metadata, clipboard, and paste. React owns presentation and
user intents.

The existing `add-voice-dictation` change remains the historical MVP baseline.
This change replaces its mixed-ownership runtime incrementally.

## 2. Coordinator State

```rust
enum DictationPhase {
    Idle,
    Starting,
    Recording,
    Transcribing,
    Polishing,
    Delivering,
    Completed,
    Failed,
}

struct DictationSession {
    id: Uuid,
    phase: DictationPhase,
    cancelled: bool,
    pending_stop: bool,
    target: Option<TargetSnapshot>,
    audio: Option<AudioArtifact>,
    raw_text: Option<String>,
    final_text: Option<String>,
    delivery: Option<DeliveryOutcome>,
}
```

Rules:

- only `Idle` can create a new session;
- stop during `Starting` sets `pending_stop` and is applied after startup;
- every async continuation checks its captured session ID;
- cancellation races in-flight ASR and LLM requests;
- the final cancel check and transition to `Delivering` are atomic;
- retry delivery uses stored final text only;
- terminal snapshots distinguish `Pasted`, `Copied`, and actual failure.

## 3. Audio Migration Boundary

Introduce an `AudioArtifact` that can represent the current WebView clip or the
future normalized PCM/WAV artifact:

```rust
enum AudioArtifact {
    Encoded {
        bytes: Vec<u8>,
        filename: String,
        mime_type: String,
        duration_ms: u64,
    },
    Pcm16Mono16k {
        pcm: Vec<u8>,
        duration_ms: u64,
        archive_path: Option<PathBuf>,
    },
}
```

Step 2 can move orchestration into Rust without first rewriting audio capture.
Step 4 replaces the encoded WebView variant with native capture.

The native recorder will use a proven audio capture/resampling stack, emit RMS
levels, monitor callback liveness, and optionally archive a temporary WAV.

## 4. ASR Provider Contract

```rust
enum AsrExecutionMode {
    Batch,
    Streaming,
}

struct AsrCapabilities {
    execution_mode: AsrExecutionMode,
    supports_partial_results: bool,
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

An adapter may explicitly return `UnsupportedCapability` for an unsupported
execution mode. The coordinator chooses behavior from capabilities rather than
matching provider names.

Initial adapter: the current OpenAI-compatible batch transcription endpoint.
Future adapters can include cloud realtime providers and local ASR without
changing coordinator phases or UI state.

## 5. LLM Provider Contract

```rust
enum ThinkingControl {
    Unsupported,
    BooleanFlag,
    ReasoningEffort,
    ProviderSpecific,
}

struct LlmCapabilities {
    supports_streaming: bool,
    thinking_control: ThinkingControl,
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

Provider adapters own transport/body/authentication and thinking controls.
`PolishService` owns Dictation prompts, context, cleanup, and raw fallback.

The first stable path is non-streaming. Streaming completion is a declared
capability for later use, not a requirement for every provider.

## 6. Provider Registry and Configuration

ASR and LLM are selected independently:

```rust
struct ProviderSelection {
    active_asr_provider_id: String,
    active_llm_provider_id: String,
}
```

The registry resolves provider configuration and secure credentials, validates
required fields, and returns an adapter plus capabilities. Provider-specific
configuration remains typed at the adapter boundary rather than leaking into
the coordinator.

Settings and diagnostics SHALL expose:

- provider ID and display name;
- endpoint and model;
- capability summary;
- credential/configuration readiness;
- last safe error category and diagnostic code;
- a provider-specific connection test where available.

## 7. Provider Failure Model

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
```

Every failure records provider ID, kind, retryability, safe user message, and
optional provider diagnostic code. Logs exclude secrets and full private text.

Retry policy:

- retry a connection/request failure only when the request is known not to
  have been accepted;
- do not automatically retry a timeout that may still be processing;
- ASR may retry from the temporary archived audio under a separate bounded
  policy;
- cancellation is never retried.

## 8. Polish Service

The default Dictation polish request:

- uses a low temperature;
- requests no/low thinking when the provider supports control;
- has a provider-aware timeout with a 30-second upper budget;
- wraps raw text in a bounded `<raw_transcript>` data envelope;
- preserves language, meaning, tone, technical literals, paths, versions, and
  proper nouns;
- removes fillers, false starts, repetition, and punctuation errors;
- does not answer or execute the dictated content;
- cleans reasoning tags, fences, and known boilerplate;
- returns `RawFallback` on any error or empty cleaned response.

A later bounded-history option may pass only recent successful turns from the
same polish style. It must output only the current turn.

## 9. Delivery Semantics

```rust
enum DeliveryOutcome {
    Pasted,
    Copied { reason: CopyFallbackReason },
    Failed(DeliveryFailure),
}
```

`Copied` is a successful terminal result. It is used when auto-paste is off,
the original app is unavailable, permission is insufficient, or key injection
cannot safely complete after the clipboard write.

On macOS the non-activating voice overlay should preserve external focus. The
delivery service posts `Cmd+V` directly when safe and may activate the captured
app if focus moved. Restoring a captured AX focused element is best effort and
must not block app-level paste.

Only clipboard-write failure is a delivery failure with no recoverable text.

## 10. UI Contract

React subscribes to a single `DictationSnapshot` and renders:

- starting;
- recording with audio level;
- transcribing;
- polishing;
- delivering;
- completed/pasted;
- completed/copied;
- failed with stage and retryability.

React sends intents: stop, cancel, retry delivery, dismiss. It does not invoke
STT, polish, and paste commands in sequence after the coordinator migration.

## 11. Migration Safety

- Keep Dictation blocked while Meeting audio is active until coexistence tests
  explicitly pass.
- Do not move Voice Ask conversation orchestration into this coordinator.
- Preserve current saved provider settings and credentials.
- Land adapters before removing the current command path.
- Keep each migration step independently testable and reversible.

