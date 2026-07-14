use super::target::TargetSnapshot;
use serde::Serialize;
use tauri::AppHandle;
use tauri_plugin_clipboard_manager::ClipboardExt;
use tokio::time::{sleep, Duration};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DictationOutputResult {
    pub pasted: bool,
    pub copied: bool,
    pub message: String,
}

pub async fn deliver<F>(
    app: &AppHandle,
    target: Option<&TargetSnapshot>,
    text: &str,
    auto_paste: bool,
    keep_result_in_clipboard: bool,
    can_paste: F,
) -> Result<DictationOutputResult, String>
where
    F: Fn() -> bool,
{
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

    if !can_paste() {
        return Ok(copied("Dictation was cancelled. Text was copied."));
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

    if !super::target::activate(app, target).await {
        let _ = crate::debug_log::append("[dictation-output] target activation failed");
        return Ok(copied("The original app is unavailable. Text was copied."));
    }

    sleep(Duration::from_millis(90)).await;
    if !can_paste() {
        return Ok(copied("Dictation was cancelled. Text was copied."));
    }
    let _ = crate::debug_log::append("[dictation-output] posting Command+V with CGEvent");
    send_paste()
        .map_err(|error| format!("Text was copied, but automatic paste failed: {error}"))?;
    let _ = crate::debug_log::append("[dictation-output] Command+V posted");

    if let Some(previous) = previous_clipboard {
        sleep(Duration::from_millis(140)).await;
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
    use core_graphics::event::{CGEvent, CGEventFlags, CGEventTapLocation};
    use core_graphics::event_source::{CGEventSource, CGEventSourceStateID};

    // ANSI V is virtual keycode 9. Posting the keycode directly avoids Enigo's
    // HIToolbox layout lookup, which macOS aborts when called off the main queue.
    const ANSI_V_KEYCODE: u16 = 9;
    let source = CGEventSource::new(CGEventSourceStateID::CombinedSessionState)
        .map_err(|_| "Failed to create a keyboard event source.".to_string())?;
    let key_down = CGEvent::new_keyboard_event(source.clone(), ANSI_V_KEYCODE, true)
        .map_err(|_| "Failed to create the paste key-down event.".to_string())?;
    let key_up = CGEvent::new_keyboard_event(source, ANSI_V_KEYCODE, false)
        .map_err(|_| "Failed to create the paste key-up event.".to_string())?;
    key_down.set_flags(CGEventFlags::CGEventFlagCommand);
    key_up.set_flags(CGEventFlags::CGEventFlagCommand);
    key_down.post(CGEventTapLocation::HID);
    key_up.post(CGEventTapLocation::HID);
    Ok(())
}

#[cfg(not(target_os = "macos"))]
fn send_paste() -> Result<(), String> {
    Err("Automatic paste is only supported on macOS.".to_string())
}
