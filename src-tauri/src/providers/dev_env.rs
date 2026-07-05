//! Dev-only fallback: seeds provider config from a local `.env` file at the
//! project root when no Keychain entry exists yet, so a developer can test
//! the STT/LLM pipeline without clicking through the Settings UI first.
//!
//! This never runs in release builds (`cfg(debug_assertions)` gate) and
//! never overwrites an existing Keychain entry — once a real key has been
//! saved (through Settings or a prior dev-env import), `.env` is ignored.
//! `.env` itself is gitignored; see the repo root `.gitignore`.

use super::config::{ProviderConfig, ProviderKind};
use super::{secrets, storage};
use tauri::AppHandle;

/// Reads `.env` from the project root (one level up from `src-tauri`, via
/// `CARGO_MANIFEST_DIR`) and imports STT/LLM config into the normal storage
/// + Keychain paths for any provider that doesn't already have a saved key.
/// Safe to call unconditionally at startup: a no-op if `.env` is missing or
/// every provider already has a key.
/// No-op in release builds: the whole `.env` fallback path only exists for
/// local development.
#[cfg(not(debug_assertions))]
pub fn seed_from_dotenv_if_missing(_app: &AppHandle) {}

#[cfg(debug_assertions)]
pub fn seed_from_dotenv_if_missing(app: &AppHandle) {
    let env_path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join(".env");

    if !env_path.exists() {
        return;
    }

    if let Err(error) = dotenvy::from_path(&env_path) {
        tracing::warn!(
            "Found .env at {} but failed to read it: {error}",
            env_path.display()
        );
        return;
    }

    seed_stt(app);
    seed_llm(app);
}

#[cfg(debug_assertions)]
fn seed_stt(app: &AppHandle) {
    if matches!(secrets::has_api_key(ProviderKind::Stt), Ok(true)) {
        return;
    }

    let Ok(api_key) = std::env::var("STT_API_KEY") else {
        return;
    };
    if api_key.trim().is_empty() {
        return;
    }

    let base_url = std::env::var("STT_BASE_URL")
        .unwrap_or_else(|_| super::config::default_stt_config().base_url);
    let model =
        std::env::var("STT_MODEL").unwrap_or_else(|_| super::config::default_stt_config().model);

    import(app, ProviderKind::Stt, base_url, model, api_key, "STT");
}

#[cfg(debug_assertions)]
fn seed_llm(app: &AppHandle) {
    if matches!(secrets::has_api_key(ProviderKind::Llm), Ok(true)) {
        return;
    }

    // Accept either LLM_API_KEY or the OPENAI_API_KEY naming the user
    // already had in their shell env.
    let Ok(api_key) = std::env::var("LLM_API_KEY").or_else(|_| std::env::var("OPENAI_API_KEY"))
    else {
        return;
    };
    if api_key.trim().is_empty() {
        return;
    }

    let base_url = std::env::var("LLM_BASE_URL")
        .or_else(|_| std::env::var("OPENAI_BASE_URL"))
        .map(|url| {
            // OPENAI_BASE_URL conventionally points at the API root
            // ("https://host/v1"); our provider config wants the full
            // chat/completions path.
            if url.ends_with("/chat/completions") {
                url
            } else {
                format!("{}/chat/completions", url.trim_end_matches('/'))
            }
        })
        .unwrap_or_else(|_| super::config::default_llm_config().base_url);
    let model =
        std::env::var("LLM_MODEL").unwrap_or_else(|_| super::config::default_llm_config().model);

    import(app, ProviderKind::Llm, base_url, model, api_key, "LLM");
}

#[cfg(debug_assertions)]
fn import(
    app: &AppHandle,
    kind: ProviderKind,
    base_url: String,
    model: String,
    api_key: String,
    label: &str,
) {
    if let Err(error) = storage::save_config(app, kind, ProviderConfig { base_url, model }) {
        tracing::warn!("Failed to seed {label} config from .env: {error}");
        return;
    }
    if let Err(error) = secrets::set_api_key(kind, &api_key) {
        tracing::warn!("Failed to seed {label} API key from .env: {error}");
        return;
    }
    tracing::info!("Seeded {label} provider config from .env (dev-only fallback).");
}
