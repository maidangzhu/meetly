use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::{fs, path::PathBuf};
use tauri::AppHandle;
use tauri_plugin_opener::OpenerExt;

use crate::providers::{config::ProviderKind, secrets};

const INDUSTRY_PRESET_IDS: &[&str] = &[
    "cro",
    "it",
    "architecture",
    "commerce",
    "finance",
    "healthcare",
    "manufacturing",
    "education",
    "custom",
];

#[derive(Debug, Clone, Serialize, Deserialize)]
struct StoredAppState {
    #[serde(default)]
    onboarding_completed: bool,
    #[serde(default)]
    industry_preset_id: String,
    #[serde(default)]
    industry_custom_text: String,
}

impl Default for StoredAppState {
    fn default() -> Self {
        Self {
            onboarding_completed: false,
            industry_preset_id: String::new(),
            industry_custom_text: String::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ListeningProfile {
    pub preset_id: String,
    pub custom_text: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OnboardingStatus {
    pub completed: bool,
    pub has_stt_key: bool,
    pub has_llm_key: bool,
}

fn state_dir() -> Result<PathBuf> {
    let dir = dirs::home_dir()
        .context("Failed to resolve home directory")?
        .join(".meetly");
    fs::create_dir_all(&dir).context("Failed to create Meetly state directory")?;
    Ok(dir)
}

fn state_path() -> Result<PathBuf> {
    Ok(state_dir()?.join("app_state.json"))
}

fn read_state() -> Result<StoredAppState> {
    let path = state_path()?;
    if !path.exists() {
        return Ok(StoredAppState::default());
    }

    let bytes = fs::read(&path).context("Failed to read app state")?;
    serde_json::from_slice(&bytes).context("Failed to parse app state")
}

fn write_state(state: &StoredAppState) -> Result<()> {
    let bytes = serde_json::to_vec_pretty(state).context("Failed to serialize app state")?;
    fs::write(state_path()?, bytes).context("Failed to write app state")
}

#[tauri::command]
pub fn get_onboarding_status() -> Result<OnboardingStatus, String> {
    let state = read_state().map_err(|error| error.to_string())?;
    Ok(OnboardingStatus {
        completed: state.onboarding_completed,
        has_stt_key: secrets::has_api_key(ProviderKind::Stt).unwrap_or(false),
        has_llm_key: secrets::has_api_key(ProviderKind::Llm).unwrap_or(false),
    })
}

#[tauri::command]
pub fn get_listening_profile() -> Result<ListeningProfile, String> {
    let state = read_state().map_err(|error| error.to_string())?;
    Ok(profile_from_state(&state))
}

#[tauri::command]
pub fn save_listening_profile(preset_id: String, custom_text: String) -> Result<ListeningProfile, String> {
    let preset_id = preset_id.trim().to_string();
    if !preset_id.is_empty() && !INDUSTRY_PRESET_IDS.contains(&preset_id.as_str()) {
        return Err("Unknown industry preset.".to_string());
    }
    let custom_text = custom_text.trim().chars().take(80).collect::<String>();
    let mut state = read_state().map_err(|error| error.to_string())?;
    state.industry_preset_id = preset_id;
    state.industry_custom_text = custom_text;
    write_state(&state).map_err(|error| error.to_string())?;
    Ok(profile_from_state(&state))
}

fn profile_from_state(state: &StoredAppState) -> ListeningProfile {
    ListeningProfile {
        preset_id: state.industry_preset_id.clone(),
        custom_text: state.industry_custom_text.clone(),
    }
}

#[tauri::command]
pub fn complete_onboarding() -> Result<(), String> {
    let mut state = read_state().map_err(|error| error.to_string())?;
    state.onboarding_completed = true;
    write_state(&state).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn open_external_url(app: AppHandle, url: String) -> Result<(), String> {
    let allowed = [
        "https://cloud.siliconflow.cn/",
        "https://platform.deepseek.com/",
        "x-apple.systempreferences:",
    ];

    if !allowed.iter().any(|prefix| url.starts_with(prefix)) {
        return Err("URL is not allowed.".to_string());
    }

    app.opener()
        .open_url(url, None::<String>)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn quit_app(app: AppHandle) {
    app.exit(0);
}
