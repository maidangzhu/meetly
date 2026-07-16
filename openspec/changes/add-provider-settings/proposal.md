# Proposal: add-provider-settings

> Historical single-profile baseline. Shared adapter registries, capability
> discovery, normalized provider failures, and future multi-profile migration
> are documented in `docs/PROVIDER_ARCHITECTURE.md` and the follow-up change
> `stabilize-voice-dictation-runtime`.

## Why

Real STT and LLM integration needs somewhere to read provider configuration
from. Today there is no settings storage at all: no way to save an API key,
base URL, or model name, and no safe place to keep secrets. This must land
before `add-system-audio-transcription` and `add-llm-suggestions` because
both depend on reading a saved provider config.

## What

- Add a `ProviderConfig` domain type: `provider_kind` (`stt` | `llm`),
  `base_url`, `model`, plus a reference to a Keychain-stored API key.
- Add local, unencrypted storage for non-secret fields (`base_url`, `model`,
  provider kind) using a JSON file under the Tauri app data dir.
- Add Keychain-backed secret storage for API keys using the `keyring` crate.
- Add Rust commands: `save_provider_config`, `get_provider_config`,
  `test_stt_config`, `test_llm_config`.
- Add a Settings window (separate Tauri window, not a floating-island panel)
  with a form for STT and LLM provider config.
- Default STT provider: SiliconFlow Whisper-compatible endpoint
  (`https://api.siliconflow.cn/v1/audio/transcriptions`,
  `model: FunAudioLLM/SenseVoiceSmall`). User can override base URL/model to
  point at any OpenAI-Whisper-compatible endpoint (OpenAI, Groq, etc.).
- Default LLM provider: SiliconFlow OpenAI-compatible chat completions
  (`https://api.siliconflow.cn/v1/chat/completions`). User can override to
  any OpenAI-compatible base URL.

## Non-goals

- No multi-profile / multi-account provider config.
- No cloud sync of settings.
- No OAuth-based providers.
- No curl-template BYOK (Pluely-style free-form curl parsing). Fields are
  fixed and structured: `base_url`, `api_key`, `model`.
