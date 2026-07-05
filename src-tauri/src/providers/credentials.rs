use super::config::{ProviderConfig, ProviderKind};
use super::{secrets, storage};
use anyhow::{anyhow, Result};
use tauri::AppHandle;

/// A resolved provider config with its API key attached. This is the only
/// place an API key and its `base_url`/`model` sit together in memory; it
/// must never be serialized, logged, or returned across the Tauri IPC
/// boundary as a whole.
pub struct ResolvedCredentials {
    pub base_url: String,
    pub model: String,
    pub api_key: String,
}

/// Reads the saved (or default) config and the Keychain-stored API key for
/// `kind`. Returns an error if no API key has been saved yet.
pub fn resolve(app: &AppHandle, kind: ProviderKind) -> Result<ResolvedCredentials> {
    let ProviderConfig { base_url, model } = storage::get_config(app, kind)?;
    let api_key = secrets::get_api_key(kind)?
        .ok_or_else(|| anyhow!("No API key configured for {}", kind.as_str()))?;

    Ok(ResolvedCredentials {
        base_url,
        model,
        api_key,
    })
}
