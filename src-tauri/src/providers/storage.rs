use super::config::{default_config_for, ProviderConfig, ProviderKind};
use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

const CONFIG_FILE_NAME: &str = "provider_config.json";

/// On-disk shape. Only non-secret fields live here; the API key never does.
#[derive(Debug, Default, Serialize, Deserialize)]
struct StoredConfig {
    stt: Option<ProviderConfig>,
    llm: Option<ProviderConfig>,
}

fn config_path(app: &AppHandle) -> Result<PathBuf> {
    let dir = app
        .path()
        .app_data_dir()
        .context("Failed to resolve app data directory")?;
    Ok(dir.join(CONFIG_FILE_NAME))
}

fn read_stored_config(app: &AppHandle) -> Result<StoredConfig> {
    let path = config_path(app)?;
    if !path.exists() {
        return Ok(StoredConfig::default());
    }

    let bytes =
        std::fs::read(&path).with_context(|| format!("Failed to read {}", path.display()))?;
    let parsed = serde_json::from_slice(&bytes)
        .with_context(|| format!("Failed to parse {}", path.display()))?;
    Ok(parsed)
}

fn write_stored_config(app: &AppHandle, config: &StoredConfig) -> Result<()> {
    let path = config_path(app)?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .with_context(|| format!("Failed to create {}", parent.display()))?;
    }

    let bytes = serde_json::to_vec_pretty(config).context("Failed to serialize provider config")?;
    std::fs::write(&path, bytes).with_context(|| format!("Failed to write {}", path.display()))?;
    Ok(())
}

/// Returns the saved config for `kind`, or the built-in default if nothing
/// has been saved yet.
pub fn get_config(app: &AppHandle, kind: ProviderKind) -> Result<ProviderConfig> {
    let stored = read_stored_config(app)?;
    let saved = match kind {
        ProviderKind::Stt => stored.stt,
        ProviderKind::Llm => stored.llm,
    };
    Ok(saved.unwrap_or_else(|| default_config_for(kind)))
}

/// Saves non-secret fields for `kind`, leaving the other provider's config
/// untouched.
pub fn save_config(app: &AppHandle, kind: ProviderKind, config: ProviderConfig) -> Result<()> {
    let mut stored = read_stored_config(app)?;
    match kind {
        ProviderKind::Stt => stored.stt = Some(config),
        ProviderKind::Llm => stored.llm = Some(config),
    }
    write_stored_config(app, &stored)
}
