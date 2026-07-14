use super::target::TargetSnapshot;
use serde::Serialize;
use std::time::Duration;
use tauri::AppHandle;
use tauri_plugin_clipboard_manager::ClipboardExt;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DictationOutputResult {
    pub pasted: bool,
    pub copied: bool,
    pub message: String,
}

pub fn deliver(
    app: &AppHandle,
    target: Option<&TargetSnapshot>,
    text: &str,
    auto_paste: bool,
    keep_result_in_clipboard: bool,
) -> Result<DictationOutputResult, String> {
    let previous_clipboard = if keep_result_in_clipboard {
        None
    } else {
        app.clipboard().read_text().ok()
    };
    app.clipboard()
        .write_text(text)
        .map_err(|error| format!("Failed to write clipboard: {error}"))?;

    if !auto_paste {
        return Ok(copied("Text copied to clipboard."));
    }

    if !handy_keys::check_accessibility() {
        return Ok(copied(
            "Accessibility permission is required for automatic paste. Text was copied.",
        ));
    }

    let Some(target) = target else {
        return Ok(copied(
            "The original target is unavailable. Text was copied.",
        ));
    };

    if !super::target::activate(target) {
        return Ok(copied("The original app is unavailable. Text was copied."));
    }

    std::thread::sleep(Duration::from_millis(90));
    send_paste()
        .map_err(|error| format!("Text was copied, but automatic paste failed: {error}"))?;

    if let Some(previous) = previous_clipboard {
        std::thread::sleep(Duration::from_millis(140));
        let _ = app.clipboard().write_text(previous);
    }

    Ok(DictationOutputResult {
        pasted: true,
        copied: true,
        message: format!(
            "Pasted into {}.",
            target.app_name.as_deref().unwrap_or("the original app")
        ),
    })
}

fn copied(message: &str) -> DictationOutputResult {
    DictationOutputResult {
        pasted: false,
        copied: true,
        message: message.to_string(),
    }
}

#[cfg(target_os = "macos")]
fn send_paste() -> Result<(), String> {
    use enigo::{Direction, Enigo, Key, Keyboard, Settings};

    let mut enigo = Enigo::new(&Settings::default()).map_err(|error| error.to_string())?;
    enigo
        .key(Key::Meta, Direction::Press)
        .map_err(|error| error.to_string())?;
    let click = enigo.key(Key::Unicode('v'), Direction::Click);
    let release = enigo.key(Key::Meta, Direction::Release);
    click.map_err(|error| error.to_string())?;
    release.map_err(|error| error.to_string())
}

#[cfg(not(target_os = "macos"))]
fn send_paste() -> Result<(), String> {
    Err("Automatic paste is only supported on macOS.".to_string())
}
