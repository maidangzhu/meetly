use super::target::TargetSnapshot;
use serde::Serialize;
use tauri::AppHandle;
use tauri_plugin_clipboard_manager::ClipboardExt;
use tokio::time::{sleep, Duration};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum DictationDeliveryOutcome {
    Pasted,
    Copied,
    Failed,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DictationOutputResult {
    pub outcome: DictationDeliveryOutcome,
    pub retryable: bool,
    pub message: String,
}

pub async fn deliver<F>(
    app: &AppHandle,
    target: Option<&TargetSnapshot>,
    text: &str,
    auto_paste: bool,
    keep_result_in_clipboard: bool,
    can_paste: F,
) -> DictationOutputResult
where
    F: Fn() -> bool,
{
    let previous_clipboard = if keep_result_in_clipboard {
        None
    } else {
        app.clipboard().read_text().ok()
    };
    if let Err(error) = app.clipboard().write_text(text) {
        return failed(&format!("Failed to write clipboard: {error}"), true);
    }

    if !auto_paste {
        return copied("Text copied to clipboard.", false);
    }

    if !can_paste() {
        return copied("Dictation was cancelled. Text was copied.", false);
    }

    if !handy_keys::check_accessibility() {
        return copied(
            "Accessibility permission is required for automatic paste. Text was copied.",
            false,
        );
    }

    let Some(target) = target else {
        return copied(
            "The original target is unavailable. Text was copied.",
            false,
        );
    };

    if !super::target::activate(app, target).await {
        let _ = crate::debug_log::append("[dictation-output] target activation failed");
        return copied("The original app is unavailable. Text was copied.", true);
    }

    sleep(Duration::from_millis(90)).await;
    if !can_paste() {
        return copied("Dictation was cancelled. Text was copied.", false);
    }

    if let Err(error) = super::target::restore_focus(target) {
        let _ = crate::debug_log::append(&format!(
            "[dictation-output] target focus restore unavailable; continuing with app-level paste error={error}"
        ));
    }

    sleep(Duration::from_millis(35)).await;
    if !can_paste() {
        return copied("Dictation was cancelled. Text was copied.", false);
    }
    let _ = crate::debug_log::append("[dictation-output] posting Command+V with CGEvent");
    if let Err(error) = send_paste() {
        let _ = crate::debug_log::append(&format!(
            "[dictation-output] Command+V failed; text remains copied error={error}"
        ));
        return copied(
            &format!("Text was copied, but automatic paste failed: {error}"),
            true,
        );
    }
    let _ = crate::debug_log::append("[dictation-output] Command+V posted");

    if let Some(previous) = previous_clipboard {
        sleep(Duration::from_millis(140)).await;
        let _ = app.clipboard().write_text(previous);
    }

    DictationOutputResult {
        outcome: DictationDeliveryOutcome::Pasted,
        retryable: false,
        message: format!(
            "Pasted into {}.",
            target.app_name.as_deref().unwrap_or("the original app")
        ),
    }
}

fn copied(message: &str, retryable: bool) -> DictationOutputResult {
    DictationOutputResult {
        outcome: DictationDeliveryOutcome::Copied,
        retryable,
        message: message.to_string(),
    }
}

fn failed(message: &str, retryable: bool) -> DictationOutputResult {
    DictationOutputResult {
        outcome: DictationDeliveryOutcome::Failed,
        retryable,
        message: message.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn copied_and_failed_results_keep_explicit_retryability() {
        let copied = copied("copied", true);
        assert_eq!(copied.outcome, DictationDeliveryOutcome::Copied);
        assert!(copied.retryable);

        let failed = failed("failed", false);
        assert_eq!(failed.outcome, DictationDeliveryOutcome::Failed);
        assert!(!failed.retryable);
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
