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
    kind: ActiveRunKind,
    target: Option<TargetSnapshot>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ActiveRunKind {
    Dictation,
    VoiceAsk,
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
        if run.id != run_id || run.kind != ActiveRunKind::Dictation {
            return Err("Dictation result belongs to a stale run.".to_string());
        }
        Ok(run.target.clone())
    }

    fn active_run(&self) -> Option<(String, ActiveRunKind)> {
        self.active
            .lock()
            .ok()
            .and_then(|active| active.as_ref().map(|run| (run.id.clone(), run.kind)))
    }

    fn finish(&self, run_id: &str, kind: ActiveRunKind) -> bool {
        let Ok(mut active) = self.active.lock() else {
            return false;
        };
        if active.as_ref().map(|run| (run.id.as_str(), run.kind)) != Some((run_id, kind)) {
            return false;
        }
        active.take();
        true
    }

    fn is_active(&self, run_id: &str, kind: ActiveRunKind) -> bool {
        self.active
            .lock()
            .map(|active| {
                active.as_ref().map(|run| (run.id.as_str(), run.kind)) == Some((run_id, kind))
            })
            .unwrap_or(false)
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

pub(crate) fn handle_shortcut_event(app: &AppHandle, pressed: bool) {
    if !pressed {
        return;
    }
    let state = app.state::<DictationState>();
    match state.active_run().map(|(_, kind)| kind) {
        Some(ActiveRunKind::Dictation) => release_run(app),
        Some(ActiveRunKind::VoiceAsk) => {}
        None => begin_run(app),
    }
}

pub(crate) fn handle_voice_ask_event(app: &AppHandle, pressed: bool) {
    if pressed {
        begin_voice_ask(app);
    } else {
        release_voice_ask(app);
    }
}

pub(crate) fn has_active_run(app: &AppHandle) -> bool {
    app.state::<DictationState>().active_run().is_some()
}

pub(crate) fn switch_voice_ask_to_dictation(app: &AppHandle) {
    let state = app.state::<DictationState>();
    let voice_ask_run_id = {
        let Ok(mut active) = state.active.lock() else {
            return;
        };
        match active.as_ref() {
            Some(run) if run.kind == ActiveRunKind::VoiceAsk => {
                let run_id = run.id.clone();
                active.take();
                Some(run_id)
            }
            _ => None,
        }
    };

    if let Some(run_id) = voice_ask_run_id {
        let _ = app.emit("voice_ask_superseded", run_id);
        begin_run(app);
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
        kind: ActiveRunKind::Dictation,
        target: target::capture(),
    });
    drop(active);

    crate::window::prepare_dictation_overlay(app);
    register_escape(app);
    let _ = app.emit(
        "dictation_shortcut_pressed",
        ShortcutPressedPayload { run_id, started_at },
    );
}

fn release_run(app: &AppHandle) {
    let state = app.state::<DictationState>();
    let run_id = state
        .active_run()
        .and_then(|(run_id, kind)| (kind == ActiveRunKind::Dictation).then_some(run_id));
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

fn begin_voice_ask(app: &AppHandle) {
    let state = app.state::<DictationState>();
    let Ok(mut active) = state.active.lock() else {
        return;
    };
    if active.is_some() {
        return;
    }

    let started_at = now_ms();
    let run_id = format!("voice-ask-{started_at:x}");
    *active = Some(ActiveRun {
        id: run_id.clone(),
        kind: ActiveRunKind::VoiceAsk,
        target: None,
    });
    drop(active);

    crate::window::prepare_voice_ask_overlay(app);
    register_escape(app);
    let _ = app.emit(
        "voice_ask_pressed",
        ShortcutPressedPayload { run_id, started_at },
    );
}

fn release_voice_ask(app: &AppHandle) {
    let state = app.state::<DictationState>();
    let run_id = state
        .active_run()
        .and_then(|(run_id, kind)| (kind == ActiveRunKind::VoiceAsk).then_some(run_id));
    if let Some(run_id) = run_id {
        let _ = app.emit(
            "voice_ask_released",
            ShortcutReleasedPayload {
                run_id,
                released_at: now_ms(),
            },
        );
    }
}

fn cancel_active(app: &AppHandle) {
    let state = app.state::<DictationState>();
    if let Some((run_id, kind)) = state.active_run() {
        let event = match kind {
            ActiveRunKind::Dictation => "dictation_cancel_requested",
            ActiveRunKind::VoiceAsk => "voice_ask_cancel_requested",
        };
        // Do not unregister Escape from inside its own shortcut callback.
        // The frontend cancellation command finishes the run and unregisters
        // it after this callback has returned, avoiding a plugin-thread deadlock.
        let _ = app.emit(event, run_id);
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
    mut settings: DictationSettings,
) -> Result<DictationStatus, String> {
    settings
        .shortcut
        .parse::<handy_keys::Hotkey>()
        .map_err(|error| format!("Invalid shortcut: {error}"))?;
    settings.activation_mode = ActivationMode::Toggle;
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
    let result = output::deliver(
        &app,
        target.as_ref(),
        &text,
        auto_paste,
        keep_result_in_clipboard,
        || state.is_active(&run_id, ActiveRunKind::Dictation),
    )
    .await;
    if should_finish_dictation_output(auto_paste, &result)
        && state.finish(&run_id, ActiveRunKind::Dictation)
    {
        unregister_escape(&app);
    }
    result
}

fn should_finish_dictation_output(
    auto_paste: bool,
    result: &Result<output::DictationOutputResult, String>,
) -> bool {
    matches!(result, Ok(output) if output.pasted || !auto_paste)
}

#[tauri::command]
pub fn finish_dictation_run(
    app: AppHandle,
    state: tauri::State<DictationState>,
    run_id: String,
) -> bool {
    let finished = state.finish(&run_id, ActiveRunKind::Dictation);
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
    let cancelled = state.finish(&run_id, ActiveRunKind::Dictation);
    if cancelled {
        unregister_escape(&app);
    }
    cancelled
}

#[tauri::command]
pub fn finish_voice_ask_run(
    app: AppHandle,
    state: tauri::State<DictationState>,
    run_id: String,
) -> bool {
    let finished = state.finish(&run_id, ActiveRunKind::VoiceAsk);
    if finished {
        unregister_escape(&app);
    }
    finished
}

#[tauri::command]
pub fn cancel_voice_ask_run(
    app: AppHandle,
    state: tauri::State<DictationState>,
    run_id: String,
) -> bool {
    let cancelled = state.finish(&run_id, ActiveRunKind::VoiceAsk);
    if cancelled {
        unregister_escape(&app);
    }
    cancelled
}

#[tauri::command]
pub async fn test_dictation_paste(app: AppHandle) -> Result<output::DictationOutputResult, String> {
    let target = target::capture();
    output::deliver(
        &app,
        target.as_ref(),
        "Meetly voice dictation paste test",
        true,
        true,
        || true,
    )
    .await
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
    fn default_shortcut_is_fn_space_toggle() {
        let settings = DictationSettings::default();
        assert_eq!(settings.shortcut, "Fn+Space");
        assert_eq!(settings.activation_mode, ActivationMode::Toggle);
        assert!(settings.shortcut.parse::<handy_keys::Hotkey>().is_ok());
    }

    #[test]
    fn stale_run_cannot_finish_active_run() {
        let state = DictationState::default();
        *state.active.lock().unwrap() = Some(ActiveRun {
            id: "current".to_string(),
            kind: ActiveRunKind::Dictation,
            target: None,
        });
        assert!(!state.finish("stale", ActiveRunKind::Dictation));
        assert!(state.active.lock().unwrap().is_some());
        assert!(state.is_active("current", ActiveRunKind::Dictation));
        assert!(!state.finish("current", ActiveRunKind::VoiceAsk));
        assert!(state.finish("current", ActiveRunKind::Dictation));
        assert!(!state.is_active("current", ActiveRunKind::Dictation));
    }

    #[test]
    fn paste_failure_keeps_run_available_for_retry() {
        let copied = Ok(output::DictationOutputResult {
            pasted: false,
            copied: true,
            message: "copied".to_string(),
        });
        let pasted = Ok(output::DictationOutputResult {
            pasted: true,
            copied: true,
            message: "pasted".to_string(),
        });
        let failed = Err("paste failed".to_string());

        assert!(!should_finish_dictation_output(true, &copied));
        assert!(!should_finish_dictation_output(true, &failed));
        assert!(should_finish_dictation_output(true, &pasted));
        assert!(should_finish_dictation_output(false, &copied));
    }
}
