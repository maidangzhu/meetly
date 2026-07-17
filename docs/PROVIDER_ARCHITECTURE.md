# Provider Architecture

Date: 2026-07-16
Status: Initial registry implemented; profile expansion and full failure migration remain proposed

## 1. Scope

Meetly will support multiple ASR and LLM providers through shared Rust
infrastructure. Provider adapters are shared; product workflows are not.

```text
                         ProviderConfigStore
                         CredentialStore
                                |
                                v
                         ProviderRegistry
                         /              \
                        v                v
                 AsrProvider          LlmProvider
                 adapters             adapters
                  /     \              /   |   \
                 v       v            v    v    v
             Meeting  Dictation   Voice Ask Coach Dictation Polish
```

Meeting, Dictation, Voice Ask, and Coach keep separate application services,
state machines, prompts, context policies, timeouts, and fallback behavior.
They do not call provider-specific HTTP clients directly.

## 2. Layer Boundaries

### 2.1 Configuration

Non-secret provider configuration contains:

- stable profile ID;
- provider adapter ID;
- kind: ASR or LLM;
- display name;
- endpoint/base URL;
- model ID;
- provider-specific non-secret options;
- enabled state.

Secrets are referenced by profile ID and stored in the secure credential
boundary. API keys and tokens never return to React in plaintext.

The current single STT config and single LLM config migrate into one default
ASR profile and one default LLM profile. The initial UI may expose only one
active profile per kind, while storage and registry types leave room for
multiple saved profiles later.

### 2.2 Registry

The registry maps `adapter_id` to an adapter factory and exposes:

- provider metadata;
- capability declarations;
- configuration validation;
- connection diagnostics;
- construction from a saved profile plus resolved credentials.

The registry does not contain Dictation, Meeting, Ask, or Coach policy.

### 2.3 Adapters

Adapters own provider-specific behavior:

- authentication and headers;
- URL and request shape;
- audio encoding or message body;
- streaming protocol parsing;
- thinking/reasoning parameters;
- provider response extraction;
- provider error-code mapping.

Adapters return provider-independent domain results and failures.

### 2.4 Application Services

Application services own product semantics:

- Meeting transcription chooses realtime/segmented behavior and transcript
  ordering.
- Dictation transcription chooses stop-to-final latency, archive retry,
  vocabulary, and delivery fallback.
- Dictation polish chooses the cleanup prompt, raw fallback, and output
  cleaning.
- Voice Ask chooses selected-text and conversation context.
- Coach chooses meeting context, wake policy, tool access, and response schema.

One provider adapter can serve several application services without forcing
them to share prompts or state.

## 3. Provider Profiles and Selection

```rust
enum ProviderKind {
    Asr,
    Llm,
}

struct ProviderProfile {
    id: String,
    kind: ProviderKind,
    adapter_id: String,
    display_name: String,
    base_url: Option<String>,
    model: String,
    options: serde_json::Value,
    enabled: bool,
}

struct ActiveProviderSelection {
    asr_profile_id: String,
    llm_profile_id: String,
}
```

The first migration keeps one global active ASR profile and one global active
LLM profile to preserve current behavior. Per-workflow selection is a later
extension and must be explicit, for example a realtime ASR for Meeting and a
batch Whisper provider for Dictation.

## 4. Capability Discovery

Capabilities are typed, not inferred from provider names or URLs.

ASR capabilities include:

- batch or streaming execution;
- accepted audio encodings;
- partial results;
- hotwords/vocabulary;
- language hints;
- verbose segment metadata;
- maximum audio duration or chunk constraints.

LLM capabilities include:

- non-streaming completion;
- streaming completion;
- structured output if supported;
- thinking/reasoning control mechanism;
- provider/model output limits.

Application services ask for required capabilities and degrade optional ones.
An unsupported required capability produces a configuration error before a
long-running user workflow starts when possible.

## 5. Shared Failure Model

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
    profile_id: String,
    adapter_id: String,
    kind: ProviderFailureKind,
    retryable: bool,
    user_message: String,
    diagnostic_code: Option<String>,
}
```

The adapter maps raw provider failures. The application service decides what
the failure means for the workflow. For example:

- Dictation LLM timeout -> deliver raw transcript;
- Dictation ASR failure -> retry archived audio, then fail transcription;
- Coach LLM timeout -> bounded retry or discard stale suggestion;
- Meeting streaming ASR disconnect -> reconnect according to session policy.

## 6. Retry and Timeout Policy

Adapters classify failures but do not independently loop forever.

- Connection failures known to occur before request acceptance may be retried
  once by a shared transport helper.
- Timeouts are not blindly retried because the provider may still be
  processing or billing the request.
- Rate limits use explicit backoff only in workflows that can wait.
- Cancellation is terminal.
- Audio retry is owned by the transcription application service because it
  requires an audio artifact and session policy.

Timeout budgets are supplied by application services with provider defaults as
inputs. Dictation polish, Coach generation, Meeting streaming, and batch ASR do
not need the same budget.

## 7. Diagnostics and Security

Settings diagnostics show:

- selected profile and adapter;
- endpoint and model;
- capability summary;
- whether credentials are present;
- connection-test result;
- normalized error category and safe diagnostic code.

Logs may include profile ID, adapter ID, stage, duration, HTTP status, provider
error code, and short redacted previews. Logs must not include:

- API keys or tokens;
- Authorization headers;
- full audio;
- full private transcript or selected text by default;
- complete provider response bodies when they may contain private input.

## 8. Initial Adapters

The first registry migration wraps current behavior:

- ASR: OpenAI-compatible multipart audio transcription;
- ASR: Xiaomi MiMo Chat Completions audio transcription with adapter-owned
  JSON/auth/response handling and shared 16 kHz mono WAV normalization;
- LLM: OpenAI-compatible chat completion.

The current UI stores one explicit active adapter ID per kind. Legacy configs
without an adapter ID are normalized only in the storage migration boundary;
workflow code does not inspect provider URLs. Multiple named profiles remain a
later extension.

Next likely adapters:

- realtime ASR for Meeting/Dictation streaming;
- additional Whisper-compatible cloud endpoints;
- provider-native LLM adapters where thinking or streaming semantics differ;
- local ASR after native audio capture and model lifecycle are designed.

Adding an adapter must not require editing React workflow state or branching on
provider name inside Dictation, Meeting, Voice Ask, or Coach.

## 9. Optional Web Search Capability

Web search is an optional Agent tool, not an LLM provider kind. Its initial
adapter is Exa and its project-wide default is disabled.

The saved setting, local credential entry, Exa transport, normalized result contract,
and tool schema are shared infrastructure. The consumers are not shared:

- Meeting Coach owns a meeting-specific Agent, context, prompt, session, wake
  policy, tool registry, cancellation policy, and Coach UI output;
- Fn Voice Ask becomes an independent general Agent with its own conversation,
  selected-text context, prompt, tool registry, run identity, and voice-overlay
  output;
- Fn+Space Dictation remains a non-Agent transcription/polish/paste workflow.

When search is enabled, each Agent application service may independently add a
`web_search` registration to its own tool registry. When disabled, neither
registry contains that tool. The Agents may use the same LLM profile and tool
factory, but they must not share an Agent instance, session, prompt, priority,
lifecycle, cancellation, or result-publication path.

Fn and Meeting Coach may run concurrently. Fn does not clear Coach wakes,
invalidate Coach epochs, suppress new meeting activity, or suspend/resume the
Coach. Wake-versus-user-action arbitration applies only to meeting Ask/Enter
inside the meeting workflow; Fn/Fn+Space arbitration remains inside the voice
workflow.

Search configuration, privacy rules, tool limits, and runtime isolation are
specified in
`openspec/changes/add-configurable-agent-web-search/design.md`.

## 10. Migration Sequence

1. Add capability and failure types around current adapters.
2. Add provider IDs/profile migration while preserving current saved config.
3. Route Dictation through the registry and Rust coordinator.
4. Route remaining direct LLM/STT calls through application services.
5. Add a second ASR or LLM adapter to prove the abstraction.
6. Add multiple saved profiles and optional per-workflow selection only after
   the single-active-profile migration is stable.

Current implementation has completed steps 1, 2, and 5 for the batch ASR path.
Dictation coordinator ownership, multiple profiles, realtime adapters, and the
remaining direct streaming LLM calls are still pending.
