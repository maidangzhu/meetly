# Tasks: add-provider-settings

- [x] Add `keyring` dependency to `src-tauri/Cargo.toml`.
- [x] Add `src-tauri/src/providers/config.rs`: `ProviderKind`, `ProviderConfig`, `DiagnosticResult`.
- [x] Add `src-tauri/src/providers/storage.rs`: read/write `provider_config.json` in the Tauri app data dir.
- [x] Add `src-tauri/src/providers/secrets.rs`: `keyring`-backed get/set/has for `stt_api_key` and `llm_api_key`.
- [x] Add commands: `save_provider_config`, `get_provider_config`, `has_api_key`, `test_stt_config`, `test_llm_config`.
- [x] Register commands in `src-tauri/src/lib.rs`.
- [x] Add default config constants (SiliconFlow base URLs/models) used when no saved config exists.
- [x] Add a new Tauri window `settings` (plain window, not the island panel) in `tauri.conf.json`.
- [x] Add `src/SettingsApp.tsx` React view with STT/LLM provider forms.
- [x] Wire "Test connection" buttons to `test_stt_config`/`test_llm_config`, show `DiagnosticResult.message`.
- [x] Confirm no command ever returns `api_key` in plaintext (manual review: `get_provider_config` returns `ProviderConfig { base_url, model }` only; `save_provider_config` takes `api_key` write-only and never echoes it back).
- [x] Run frontend build.
- [x] Run Rust check.
- [ ] Manually verify: save a fake STT key, restart app, confirm `has_api_key` still true and `get_provider_config` still omits the key. (Not run — requires clicking through the Settings UI; app builds and launches cleanly, but this specific click-through has not been exercised yet.)
