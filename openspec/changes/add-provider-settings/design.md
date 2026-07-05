# Design: add-provider-settings

## Context

`docs/TECHNICAL_DESIGN.md` originally proposed `tauri-plugin-stronghold` for
secret storage and a WebSocket-streaming Aliyun STT provider. Both decisions
changed after reviewing `pluely-master`'s actual implementation:

- STT moved to a Pluely-style batch flow (VAD-sliced WAV -> one-shot HTTP
  POST -> text back), not a persistent WebSocket. See
  `add-system-audio-transcription/design.md`.
- Secret storage moves to the `keyring` crate (native macOS Keychain) instead
  of Stronghold, because Stronghold requires the user to set and remember a
  vault password, which adds friction for a single-machine macOS-only app.
  `keyring` reads/writes the Keychain directly, no vault password.

## Goals / Non-Goals

Goals:
- One STT config, one LLM config, stored locally.
- Non-secret fields are readable without extra dependencies.
- Secret fields never touch disk in plaintext, never appear in logs, never
  cross the Tauri IPC boundary to the frontend.

Non-goals:
- Provider marketplace / multi-account switching.
- Encrypting non-secret fields (base_url/model are not sensitive).

## Decisions

### Storage split

```text
~/Library/Application Support/com.maidang.meetly/provider_config.json
  { "stt": { "base_url": "...", "model": "..." },
    "llm": { "base_url": "...", "model": "..." } }

macOS Keychain (via `keyring` crate)
  service = "com.maidang.meetly"
  account = "stt_api_key" | "llm_api_key"
```

- Decision: plain JSON file for non-secret fields instead of SQLite. At this
  scale (2 provider configs, no history) SQLite is unjustified complexity.
  `docs/TECHNICAL_DESIGN.md` reserved SQLite for future settings/session
  tables; this change does not need it yet and does not add the
  `tauri-plugin-sql` dependency.
- Decision: `keyring` crate over `tauri-plugin-stronghold`. Rationale above.

### Domain type

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum ProviderKind {
    Stt,
    Llm,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProviderConfig {
    pub base_url: String,
    pub model: String,
    // api_key is never included in this struct. It is written/read
    // separately through the keyring and never serialized alongside
    // base_url/model.
}
```

### Commands

```rust
#[tauri::command]
async fn save_provider_config(
    kind: ProviderKind,
    base_url: String,
    model: String,
    api_key: String, // write-only: goes straight to keyring, never echoed back
) -> Result<(), String>;

#[tauri::command]
async fn get_provider_config(kind: ProviderKind) -> Result<ProviderConfig, String>;
// Returns base_url/model only. Never returns api_key. The frontend shows a
// masked placeholder ("••••••••") when a key exists, determined by a
// separate has_api_key: bool field, not the key itself.

#[tauri::command]
async fn has_api_key(kind: ProviderKind) -> Result<bool, String>;

#[tauri::command]
async fn test_stt_config() -> Result<DiagnosticResult, String>;
// Sends a tiny known-silence WAV sample to the configured STT endpoint and
// checks for a 2xx response. Does not require a real recording.

#[tauri::command]
async fn test_llm_config() -> Result<DiagnosticResult, String>;
// Sends a minimal chat completion request ("respond with OK") and checks
// for a 2xx response with non-empty content.
```

`DiagnosticResult`:

```rust
#[derive(Debug, Serialize)]
pub struct DiagnosticResult {
    pub success: bool,
    pub message: String, // user-readable; never includes the API key or
                          // full Authorization header
}
```

### Defaults

| Field | STT default | LLM default |
|---|---|---|
| base_url | `https://api.siliconflow.cn/v1/audio/transcriptions` | `https://api.siliconflow.cn/v1/chat/completions` |
| model | `FunAudioLLM/SenseVoiceSmall` | `Qwen/Qwen3-32B` (placeholder; user can change) |

Both are OpenAI-compatible endpoints. A user who prefers OpenAI, Groq, or any
other OpenAI-Whisper/chat-compatible provider only needs to change
`base_url`, `model`, and `api_key`; no code path changes because both STT and
LLM adapters assume the OpenAI request/response shape (see
`add-system-audio-transcription/design.md` and
`add-llm-suggestions/design.md`).

## Risks / Trade-offs

- Plain JSON for base_url/model means anyone with filesystem access to the
  app data dir can read which provider/model is configured. Accepted: these
  are not secrets, and the API key itself never lands there.
- `keyring` crate depends on the Security.framework on macOS. This project is
  macOS-only already (`docs/PROJECT_RULES.md`), so no cross-platform keyring
  backend concerns apply.

## Migration Plan

New feature, no migration needed. On first run, `get_provider_config`
returns the defaults above with `has_api_key: false` until the user saves a
key.

## Open Questions

None. Both prior open questions (Stronghold vs Keychain, curl-template vs
fixed fields) were resolved in conversation before this change was drafted.
