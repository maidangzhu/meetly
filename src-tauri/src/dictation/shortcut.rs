use super::DictationState;
use handy_keys::{Hotkey, HotkeyManager, HotkeyState, Modifiers};
use std::{
    sync::mpsc,
    thread::{self, JoinHandle},
    time::{Duration, Instant},
};
use tauri::AppHandle;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

const FN_HOLD_DELAY: Duration = Duration::from_millis(300);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ShortcutAction {
    DictationPressed,
    SwitchVoiceAskToDictation,
    VoiceAskPressed,
    VoiceAskReleased,
}

#[derive(Debug, Default)]
struct FnAskCoordinator {
    fn_pressed_at: Option<Instant>,
    voice_ask_active: bool,
    suppress_voice_until_fn_release: bool,
}

impl FnAskCoordinator {
    fn on_fn_event(&mut self, pressed: bool, now: Instant) -> Vec<ShortcutAction> {
        if pressed {
            if !self.suppress_voice_until_fn_release && !self.voice_ask_active {
                self.fn_pressed_at = Some(now);
            }
            return Vec::new();
        }

        self.fn_pressed_at = None;
        self.suppress_voice_until_fn_release = false;
        if self.voice_ask_active {
            self.voice_ask_active = false;
            return vec![ShortcutAction::VoiceAskReleased];
        }
        Vec::new()
    }

    fn on_dictation_event(&mut self, pressed: bool) -> Vec<ShortcutAction> {
        if !pressed {
            return Vec::new();
        }

        self.fn_pressed_at = None;
        self.suppress_voice_until_fn_release = true;
        if self.voice_ask_active {
            self.voice_ask_active = false;
            return vec![ShortcutAction::SwitchVoiceAskToDictation];
        }
        vec![ShortcutAction::DictationPressed]
    }

    fn tick(&mut self, now: Instant) -> Vec<ShortcutAction> {
        let Some(pressed_at) = self.fn_pressed_at else {
            return Vec::new();
        };
        if self.suppress_voice_until_fn_release || now.duration_since(pressed_at) < FN_HOLD_DELAY {
            return Vec::new();
        }

        self.fn_pressed_at = None;
        self.voice_ask_active = true;
        vec![ShortcutAction::VoiceAskPressed]
    }
}

#[derive(Debug, Default)]
struct ShortcutEdgeFilter {
    pressed: bool,
}

impl ShortcutEdgeFilter {
    fn accept(&mut self, pressed: bool) -> Option<bool> {
        if self.pressed == pressed {
            return None;
        }
        self.pressed = pressed;
        Some(pressed)
    }

    #[cfg(test)]
    fn reset(&mut self) {
        self.pressed = false;
    }
}

pub struct ShortcutRuntime {
    stop_tx: Option<mpsc::Sender<()>>,
    handle: Option<JoinHandle<()>>,
    fallback_shortcut: Option<String>,
}

impl ShortcutRuntime {
    fn native(stop_tx: mpsc::Sender<()>, handle: JoinHandle<()>) -> Self {
        Self {
            stop_tx: Some(stop_tx),
            handle: Some(handle),
            fallback_shortcut: None,
        }
    }

    fn fallback(shortcut: String) -> Self {
        Self {
            stop_tx: None,
            handle: None,
            fallback_shortcut: Some(shortcut),
        }
    }

    pub fn stop(mut self, app: &AppHandle) {
        if let Some(tx) = self.stop_tx.take() {
            let _ = tx.send(());
        }
        if let Some(handle) = self.handle.take() {
            let _ = handle.join();
        }
        if let Some(shortcut) = self.fallback_shortcut.take() {
            let _ = app.global_shortcut().unregister(shortcut.as_str());
        }
    }
}

pub fn restart(app: &AppHandle, state: &DictationState) {
    if let Ok(mut runtime) = state.shortcut_runtime.lock() {
        if let Some(previous) = runtime.take() {
            previous.stop(app);
        }
    }

    let settings = state.settings();
    if !settings.enabled {
        state.set_shortcut_status("disabled", None);
        return;
    }

    match start_native(app, state, &settings.shortcut) {
        Ok(runtime) => {
            tracing::info!(shortcut = %settings.shortcut, "dictation native shortcut registered");
            state.set_shortcut_status("native", None);
            if let Ok(mut current) = state.shortcut_runtime.lock() {
                *current = Some(runtime);
            }
        }
        Err(native_error) => match start_fallback(app, state, &settings.fallback_shortcut) {
            Ok(runtime) => {
                tracing::warn!(
                    shortcut = %settings.fallback_shortcut,
                    native_error = %native_error,
                    "dictation using fallback shortcut"
                );
                state.set_shortcut_status("fallback", Some(native_error));
                if let Ok(mut current) = state.shortcut_runtime.lock() {
                    *current = Some(runtime);
                }
            }
            Err(fallback_error) => {
                tracing::error!(
                    native_error = %native_error,
                    fallback_error = %fallback_error,
                    "dictation shortcut unavailable"
                );
                state.set_shortcut_status(
                    "unavailable",
                    Some(format!(
                        "Native shortcut failed: {native_error}. Fallback failed: {fallback_error}"
                    )),
                );
            }
        },
    }
}

fn start_native(
    app: &AppHandle,
    _state: &DictationState,
    shortcut: &str,
) -> Result<ShortcutRuntime, String> {
    let hotkey: Hotkey = shortcut
        .parse()
        .map_err(|error| format!("Invalid shortcut '{shortcut}': {error}"))?;
    let dictation_manager =
        HotkeyManager::new_with_blocking().map_err(|error| error.to_string())?;
    let dictation_id = dictation_manager
        .register(hotkey)
        .map_err(|error| error.to_string())?;
    let voice_ask_manager = HotkeyManager::new().map_err(|error| error.to_string())?;
    let fn_only = Hotkey::new(Modifiers::FN, None).map_err(|error| error.to_string())?;
    let voice_ask_id = voice_ask_manager
        .register(fn_only)
        .map_err(|error| error.to_string())?;

    let app = app.clone();
    let (stop_tx, stop_rx) = mpsc::channel();
    let handle = thread::spawn(move || {
        let mut coordinator = FnAskCoordinator::default();
        loop {
            if stop_rx.try_recv().is_ok() {
                break;
            }

            while let Some(event) = voice_ask_manager.try_recv() {
                if event.id == voice_ask_id {
                    let pressed = event.state == HotkeyState::Pressed;
                    dispatch_actions(&app, coordinator.on_fn_event(pressed, Instant::now()));
                }
            }

            while let Some(event) = dictation_manager.try_recv() {
                if event.id == dictation_id {
                    let pressed = event.state == HotkeyState::Pressed;
                    dispatch_actions(&app, coordinator.on_dictation_event(pressed));
                }
            }

            dispatch_actions(&app, coordinator.tick(Instant::now()));
            thread::sleep(Duration::from_millis(8));
        }
    });
    Ok(ShortcutRuntime::native(stop_tx, handle))
}

fn dispatch_actions(app: &AppHandle, actions: Vec<ShortcutAction>) {
    for action in actions {
        let _ = crate::debug_log::append(&format!("[voice-shortcut] action={action:?}"));
        match action {
            ShortcutAction::DictationPressed => super::handle_shortcut_event(app, true),
            ShortcutAction::SwitchVoiceAskToDictation => super::switch_voice_ask_to_dictation(app),
            ShortcutAction::VoiceAskPressed => super::handle_voice_ask_event(app, true),
            ShortcutAction::VoiceAskReleased => super::handle_voice_ask_event(app, false),
        }
    }
}

fn start_fallback(
    app: &AppHandle,
    _state: &DictationState,
    shortcut: &str,
) -> Result<ShortcutRuntime, String> {
    let shortcut_owned = shortcut.to_string();
    let edges = std::sync::Mutex::new(ShortcutEdgeFilter::default());
    app.global_shortcut()
        .on_shortcut(shortcut, move |app, _, event| {
            let pressed = event.state == ShortcutState::Pressed;
            if let Ok(mut edges) = edges.lock() {
                if let Some(pressed) = edges.accept(pressed) {
                    super::handle_shortcut_event(app, pressed);
                }
            }
        })
        .map_err(|error| error.to_string())?;
    Ok(ShortcutRuntime::fallback(shortcut_owned))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn suppresses_key_repeat_until_release() {
        let mut filter = ShortcutEdgeFilter::default();
        assert_eq!(filter.accept(true), Some(true));
        assert_eq!(filter.accept(true), None);
        assert_eq!(filter.accept(true), None);
        assert_eq!(filter.accept(false), Some(false));
        assert_eq!(filter.accept(false), None);
    }

    #[test]
    fn accepts_quick_press_release_as_one_pair() {
        let mut filter = ShortcutEdgeFilter::default();
        assert_eq!(filter.accept(true), Some(true));
        assert_eq!(filter.accept(false), Some(false));
    }

    #[test]
    fn reset_recovers_from_interrupted_pressed_state() {
        let mut filter = ShortcutEdgeFilter::default();
        assert_eq!(filter.accept(true), Some(true));
        filter.reset();
        assert_eq!(filter.accept(true), Some(true));
    }

    #[test]
    fn fn_space_matcher_is_supported() {
        assert!("Fn+Space".parse::<Hotkey>().is_ok());
    }

    #[test]
    fn holding_fn_starts_and_releasing_finishes_voice_ask() {
        let now = Instant::now();
        let mut coordinator = FnAskCoordinator::default();
        assert!(coordinator.on_fn_event(true, now).is_empty());
        assert!(coordinator
            .tick(now + FN_HOLD_DELAY - Duration::from_millis(1))
            .is_empty());
        assert_eq!(
            coordinator.tick(now + FN_HOLD_DELAY),
            vec![ShortcutAction::VoiceAskPressed]
        );
        assert_eq!(
            coordinator.on_fn_event(false, now + FN_HOLD_DELAY),
            vec![ShortcutAction::VoiceAskReleased]
        );
    }

    #[test]
    fn fn_space_suppresses_voice_ask_and_triggers_dictation() {
        let now = Instant::now();
        let mut coordinator = FnAskCoordinator::default();
        coordinator.on_fn_event(true, now);
        assert_eq!(
            coordinator.on_dictation_event(true),
            vec![ShortcutAction::DictationPressed]
        );
        assert!(coordinator.tick(now + FN_HOLD_DELAY).is_empty());
        assert!(coordinator.on_dictation_event(false).is_empty());
        assert!(coordinator
            .on_fn_event(false, now + FN_HOLD_DELAY)
            .is_empty());
    }

    #[test]
    fn late_space_switches_voice_ask_to_dictation() {
        let now = Instant::now();
        let mut coordinator = FnAskCoordinator::default();
        coordinator.on_fn_event(true, now);
        assert_eq!(
            coordinator.tick(now + FN_HOLD_DELAY),
            vec![ShortcutAction::VoiceAskPressed]
        );
        assert_eq!(
            coordinator.on_dictation_event(true),
            vec![ShortcutAction::SwitchVoiceAskToDictation]
        );
    }
}
