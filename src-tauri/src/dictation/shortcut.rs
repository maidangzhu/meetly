use super::DictationState;
use handy_keys::{Hotkey, HotkeyManager, HotkeyState};
use std::{
    sync::mpsc,
    thread::{self, JoinHandle},
    time::Duration,
};
use tauri::AppHandle;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

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
    let manager = HotkeyManager::new_with_blocking().map_err(|error| error.to_string())?;
    manager
        .register(hotkey)
        .map_err(|error| error.to_string())?;

    let app = app.clone();
    let (stop_tx, stop_rx) = mpsc::channel();
    let handle = thread::spawn(move || {
        let mut edges = ShortcutEdgeFilter::default();
        loop {
            if stop_rx.try_recv().is_ok() {
                edges.reset();
                break;
            }
            while let Some(event) = manager.try_recv() {
                let pressed = event.state == HotkeyState::Pressed;
                if let Some(pressed) = edges.accept(pressed) {
                    super::handle_shortcut_event(&app, pressed);
                }
            }
            thread::sleep(Duration::from_millis(8));
        }
    });
    Ok(ShortcutRuntime::native(stop_tx, handle))
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
}
