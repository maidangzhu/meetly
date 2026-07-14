mod output;
mod polish;
mod settings;
mod shortcut;
mod target;

use crate::audio;
use serde::Serialize;
use settings::{ActivationMode, DictationSettings};
use shortcut::ShortcutRuntime;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};
use target::TargetSnapshot;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

const ESCAPE_SHORTCUT: &str = "Escape";

#[derive(Debug, Clone)]
struct ActiveRun {
    id: String,
    target: Option<TargetSnapshot>,
}

#[derive(Debug, Clone, Default)]
struct ShortcutStatus {
    backend: String,
    error: Option<String>,
}

pub struct DictationState {
    active: Mutex<Option<ActiveRun>>,
    settings: Mutex<DictationSettings>,
    shortcut_status: Mutex<ShortcutStatus>,
    pub(crate) shortcut_runtime: Mutex<Option<ShortcutRuntime>>,
}

impl Default for DictationState {
    fn default() -> Self {
        Self {
            active: Mutex::new(None),
            settings: Mutex::new(DictationSettings::default()),
            shortcut_status: Mutex::new(ShortcutStatus::default()),
            shortcut_runtime: Mutex::new(None),
        }
    }
}

impl DictationState {
    fn settings(&self) -> DictationSettings {
        self.settings
            .lock()
            .map(|settings| settings.clone())
            .unwrap_or_default()
    }

    fn set_settings(&self, next: DictationSettings) {
        if let Ok(mut settings) = self.settings.lock() {
            *settings = next;
        }
    }

    fn set_shortcut_status(&self, backend: &str, error: Option<String>) {
        if let Ok(mut status) = self.shortcut_status.lock() {
            status.backend = backend.to_string();
            status.error = error;
        }
    }

    fn active_target(&self, run_id: &str) -> Result<Option<TargetSnapshot>, String> {
        let active = self
            .active
            .lock()
            .map_err(|error| format!("Failed to read Dictation state: {error}"))?;
        let Some(run) = active.as_ref() else {
            return Err("Dictation run is no longer active.".to_string());
        };
        if run.id != run_id {
            return Err("Dictation result belongs to a stale run.".to_string());
        }
        Ok(run.target.clone())
    }

    fn finish(&self, run_id: &str) -> bool {
        let Ok(mut active) = self.active.lock() else {
            return false;
        };
        if active.as_ref().map(|run| run.id.as_str()) != Some(run_id) {
            return false;
        }
        active.take();
        true
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ShortcutPressedPayload {
    run_id: String,
    started_at: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ShortcutReleasedPayload {
    run_id: String,
    released_at: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct BlockedPayload {
    reason: String,
    message: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DictationStatus {
    settings: DictationSettings,
    active: bool,
    accessibility_granted: bool,
    microphone_permission: String,
    shortcut_backend: String,
    shortcut_error: Option<String>,
}

#[cfg(target_os = "macos")]
fn microphone_permission() -> String {
    use cidre::av;

    match av::CaptureDevice::authorization_status_for_media_type(av::MediaType::audio()) {
        Ok(av::AuthorizationStatus::Authorized) => "authorized",
        Ok(av::AuthorizationStatus::NotDetermined) => "not_determined",
        Ok(av::AuthorizationStatus::Denied) => "denied",
        Ok(av::AuthorizationStatus::Restricted) => "restricted",
        Err(_) => "unknown",
    }
    .to_string()
}

#[cfg(not(target_os = "macos"))]
fn microphone_permission() -> String {
    "unknown".to_string()
}

pub fn initialize(app: &AppHandle) {
    let state = app.state::<DictationState>();
    match settings::load(app) {
        Ok(saved) => state.set_settings(saved),
        Err(error) => {
            state.set_shortcut_status("unavailable", Some(error.to_string()));
        }
    }
    shortcut::restart(app, &state);
}

pub(crate) fn handle_shortcut_event(
    app: &AppHandle,
    pressed: bool,
    activation_mode: &ActivationMode,
) {
    match activation_mode {
        ActivationMode::PushToTalk => {
            if pressed {
                begin_run(app);
            } else {
                release_run(app);
            }
        }
        ActivationMode::Toggle => {
            if !pressed {
                return;
            }
            let state = app.state::<DictationState>();
            let active = state
                .active
                .lock()
                .map(|run| run.is_some())
                .unwrap_or(false);
            if active {
                release_run(app);
            } else {
                begin_run(app);
            }
        }
    }
}

fn begin_run(app: &AppHandle) {
    let state = app.state::<DictationState>();
    if let Some(audio_state) = app.try_state::<audio::AudioState>() {
        if audio::is_listening(&audio_state) {
            emit_blocked(app, "meeting_active", "会议监听中，语音输入暂不可用。");
            return;
        }
    }

    let Ok(mut active) = state.active.lock() else {
        emit_blocked(app, "state_error", "无法读取语音输入状态。");
        return;
    };
    if active.is_some() {
        return;
    }

    let started_at = now_ms();
    let run_id = format!("dictation-{started_at:x}");
    *active = Some(ActiveRun {
        id: run_id.clone(),
        target: target::capture(),
    });
    drop(active);

    register_escape(app);
    let _ = app.emit(
        "dictation_shortcut_pressed",
        ShortcutPressedPayload { run_id, started_at },
    );
}

fn release_run(app: &AppHandle) {
    let state = app.state::<DictationState>();
    let run_id = state
        .active
        .lock()
        .ok()
        .and_then(|run| run.as_ref().map(|run| run.id.clone()));
    if let Some(run_id) = run_id {
        let _ = app.emit(
            "dictation_shortcut_released",
            ShortcutReleasedPayload {
                run_id,
                released_at: now_ms(),
            },
        );
    }
}

fn cancel_active(app: &AppHandle) {
    let state = app.state::<DictationState>();
    let run_id = state
        .active
        .lock()
        .ok()
        .and_then(|mut run| run.take().map(|run| run.id));
    if let Some(run_id) = run_id {
        unregister_escape(app);
        let _ = app.emit("dictation_cancel_requested", run_id);
    }
}

fn emit_blocked(app: &AppHandle, reason: &str, message: &str) {
    let _ = app.emit(
        "dictation_blocked",
        BlockedPayload {
            reason: reason.to_string(),
            message: message.to_string(),
        },
    );
}

fn register_escape(app: &AppHandle) {
    if app.global_shortcut().is_registered(ESCAPE_SHORTCUT) {
        return;
    }
    let _ = app
        .global_shortcut()
        .on_shortcut(ESCAPE_SHORTCUT, |app, _, event| {
            if event.state == ShortcutState::Pressed {
                cancel_active(app);
            }
        });
}

fn unregister_escape(app: &AppHandle) {
    let _ = app.global_shortcut().unregister(ESCAPE_SHORTCUT);
}

#[tauri::command]
pub fn get_dictation_settings(state: tauri::State<DictationState>) -> DictationSettings {
    state.settings()
}

#[tauri::command]
pub fn get_dictation_status(state: tauri::State<DictationState>) -> DictationStatus {
    let status = state
        .shortcut_status
        .lock()
        .ok()
        .map(|status| status.clone());
    let active = state
        .active
        .lock()
        .map(|run| run.is_some())
        .unwrap_or(false);
    DictationStatus {
        settings: state.settings(),
        active,
        accessibility_granted: handy_keys::check_accessibility(),
        microphone_permission: microphone_permission(),
        shortcut_backend: status
            .as_ref()
            .map(|status| status.backend.clone())
            .unwrap_or_else(|| "unavailable".to_string()),
        shortcut_error: status.and_then(|status| status.error),
    }
}

#[tauri::command]
pub fn save_dictation_settings(
    app: AppHandle,
    state: tauri::State<DictationState>,
    settings: DictationSettings,
) -> Result<DictationStatus, String> {
    settings
        .shortcut
        .parse::<handy_keys::Hotkey>()
        .map_err(|error| format!("Invalid shortcut: {error}"))?;
    settings::save(&app, &settings).map_err(|error| error.to_string())?;
    state.set_settings(settings);
    shortcut::restart(&app, &state);
    let _ = app.emit("dictation_settings_changed", state.settings());
    Ok(get_dictation_status(state))
}

#[tauri::command]
pub fn request_dictation_accessibility() -> Result<(), String> {
    handy_keys::open_accessibility_settings().map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn polish_dictation(
    app: AppHandle,
    state: tauri::State<'_, DictationState>,
    run_id: String,
    raw_text: String,
) -> Result<String, String> {
    state.active_target(&run_id)?;
    polish::run(&app, &raw_text).await
}

#[tauri::command]
pub async fn paste_dictation_text(
    app: AppHandle,
    state: tauri::State<'_, DictationState>,
    run_id: String,
    text: String,
    auto_paste: bool,
    keep_result_in_clipboard: bool,
) -> Result<output::DictationOutputResult, String> {
    let target = state.active_target(&run_id)?;
    let app_for_output = app.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        output::deliver(
            &app_for_output,
            target.as_ref(),
            &text,
            auto_paste,
            keep_result_in_clipboard,
        )
    })
    .await
    .map_err(|error| error.to_string())?;
    if state.finish(&run_id) {
        unregister_escape(&app);
    }
    result
}

#[tauri::command]
pub fn finish_dictation_run(
    app: AppHandle,
    state: tauri::State<DictationState>,
    run_id: String,
) -> bool {
    let finished = state.finish(&run_id);
    if finished {
        unregister_escape(&app);
    }
    finished
}

#[tauri::command]
pub fn cancel_dictation_run(
    app: AppHandle,
    state: tauri::State<DictationState>,
    run_id: String,
) -> bool {
    let cancelled = state.finish(&run_id);
    if cancelled {
        unregister_escape(&app);
    }
    cancelled
}

#[tauri::command]
pub async fn test_dictation_paste(app: AppHandle) -> Result<output::DictationOutputResult, String> {
    let target = target::capture();
    let app_for_output = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        output::deliver(
            &app_for_output,
            target.as_ref(),
            "Meetly voice dictation paste test",
            true,
            true,
        )
    })
    .await
    .map_err(|error| error.to_string())?
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_shortcut_is_fn_space_push_to_talk() {
        let settings = DictationSettings::default();
        assert_eq!(settings.shortcut, "Fn+Space");
        assert_eq!(settings.activation_mode, ActivationMode::PushToTalk);
        assert!(settings.shortcut.parse::<handy_keys::Hotkey>().is_ok());
    }

    #[test]
    fn stale_run_cannot_finish_active_run() {
        let state = DictationState::default();
        *state.active.lock().unwrap() = Some(ActiveRun {
            id: "current".to_string(),
            target: None,
        });
        assert!(!state.finish("stale"));
        assert!(state.active.lock().unwrap().is_some());
        assert!(state.finish("current"));
    }
}
