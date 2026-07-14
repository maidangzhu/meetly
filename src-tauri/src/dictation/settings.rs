use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::{fs, path::PathBuf};
use tauri::{AppHandle, Manager};

const FILE_NAME: &str = "dictation_settings.json";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ActivationMode {
    #[serde(alias = "push_to_talk")]
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
            activation_mode: ActivationMode::Toggle,
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
    let mut settings: DictationSettings = serde_json::from_slice(&bytes)
        .with_context(|| format!("Failed to parse {}", path.display()))?;
    // Dictation now follows Typeless-style toggle interaction. Normalize older
    // push-to-talk settings so existing installations adopt the new behavior.
    settings.activation_mode = ActivationMode::Toggle;
    Ok(settings)
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

#[cfg(test)]
mod tests {
    use super::ActivationMode;

    #[test]
    fn legacy_push_to_talk_value_migrates_to_toggle() {
        let mode: ActivationMode = serde_json::from_str("\"push_to_talk\"").unwrap();
        assert_eq!(mode, ActivationMode::Toggle);
    }
}
