use super::config::{
    default_config_for, infer_legacy_provider, ProviderConfig, ProviderId, ProviderKind,
};
use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

const CONFIG_FILE_NAME: &str = "provider_config.json";

#[derive(Debug, Default, Serialize, Deserialize)]
struct StoredConfig {
    stt: Option<StoredProviderConfig>,
    llm: Option<StoredProviderConfig>,
}

#[derive(Debug, Serialize, Deserialize)]
struct StoredProviderConfig {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    provider_id: Option<ProviderId>,
    base_url: String,
    model: String,
}

impl StoredProviderConfig {
    fn into_config(self, kind: ProviderKind) -> ProviderConfig {
        let provider_id = self
            .provider_id
            .unwrap_or_else(|| infer_legacy_provider(kind, &self.base_url, &self.model));
        ProviderConfig {
            provider_id,
            base_url: self.base_url,
            model: self.model,
        }
    }
}

impl From<ProviderConfig> for StoredProviderConfig {
    fn from(config: ProviderConfig) -> Self {
        Self {
            provider_id: Some(config.provider_id),
            base_url: config.base_url,
            model: config.model,
        }
    }
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
    serde_json::from_slice(&bytes).with_context(|| format!("Failed to parse {}", path.display()))
}

fn write_stored_config(app: &AppHandle, config: &StoredConfig) -> Result<()> {
    let path = config_path(app)?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .with_context(|| format!("Failed to create {}", parent.display()))?;
    }

    let bytes = serde_json::to_vec_pretty(config).context("Failed to serialize provider config")?;
    std::fs::write(&path, bytes).with_context(|| format!("Failed to write {}", path.display()))
}

pub fn get_config(app: &AppHandle, kind: ProviderKind) -> Result<ProviderConfig> {
    let stored = read_stored_config(app)?;
    let saved = match kind {
        ProviderKind::Stt => stored.stt,
        ProviderKind::Llm => stored.llm,
    };
    Ok(saved
        .map(|config| config.into_config(kind))
        .unwrap_or_else(|| default_config_for(kind)))
}

pub fn save_config(app: &AppHandle, kind: ProviderKind, config: ProviderConfig) -> Result<()> {
    let mut stored = read_stored_config(app)?;
    match kind {
        ProviderKind::Stt => stored.stt = Some(config.into()),
        ProviderKind::Llm => stored.llm = Some(config.into()),
    }
    write_stored_config(app, &stored)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn deserializes_legacy_config_without_provider_id() {
        let stored: StoredConfig = serde_json::from_str(
            r#"{
                "stt": {
                    "base_url": "https://api.xiaomimimo.com/v1/chat/completions",
                    "model": "mimo-v2.5-asr"
                }
            }"#,
        )
        .unwrap();
        let config = stored.stt.unwrap().into_config(ProviderKind::Stt);
        assert_eq!(config.provider_id, ProviderId::XiaomiMimo);
    }

    #[test]
    fn newly_saved_config_persists_explicit_provider_id() {
        let stored = StoredProviderConfig::from(ProviderConfig {
            provider_id: ProviderId::XiaomiMimo,
            base_url: "https://api.xiaomimimo.com/v1/chat/completions".to_string(),
            model: "mimo-v2.5-asr".to_string(),
        });
        let json = serde_json::to_value(stored).unwrap();
        assert_eq!(json["provider_id"], "xiaomi_mimo");
    }
}
