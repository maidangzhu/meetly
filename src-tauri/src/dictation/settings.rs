use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::{fs, path::PathBuf};
use tauri::{AppHandle, Manager};

const FILE_NAME: &str = "dictation_settings.json";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ActivationMode {
    PushToTalk,
    Toggle,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DictationSettings {
    pub enabled: bool,
    pub shortcut: String,
    pub fallback_shortcut: String,
    pub activation_mode: ActivationMode,
    pub ai_polish_enabled: bool,
    pub auto_paste_enabled: bool,
    pub keep_result_in_clipboard: bool,
}

impl Default for DictationSettings {
    fn default() -> Self {
        Self {
            enabled: true,
            shortcut: "Fn+Space".to_string(),
            fallback_shortcut: "Alt+Space".to_string(),
            activation_mode: ActivationMode::PushToTalk,
            ai_polish_enabled: true,
            auto_paste_enabled: true,
            keep_result_in_clipboard: true,
        }
    }
}

fn path(app: &AppHandle) -> Result<PathBuf> {
    Ok(app
        .path()
        .app_data_dir()
        .context("Failed to resolve app data directory")?
        .join(FILE_NAME))
}

pub fn load(app: &AppHandle) -> Result<DictationSettings> {
    let path = path(app)?;
    if !path.exists() {
        return Ok(DictationSettings::default());
    }
    let bytes = fs::read(&path).with_context(|| format!("Failed to read {}", path.display()))?;
    serde_json::from_slice(&bytes).with_context(|| format!("Failed to parse {}", path.display()))
}

pub fn save(app: &AppHandle, settings: &DictationSettings) -> Result<()> {
    let path = path(app)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .with_context(|| format!("Failed to create {}", parent.display()))?;
    }
    let bytes = serde_json::to_vec_pretty(settings).context("Failed to serialize settings")?;
    fs::write(&path, bytes).with_context(|| format!("Failed to write {}", path.display()))
}
