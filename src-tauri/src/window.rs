use std::{sync::Mutex, time::Duration};
use tauri::{App, Manager, PhysicalPosition, PhysicalSize, Position, State, WebviewWindow};

const COLLAPSED_WIDTH: f64 = 600.0;
const EXPANDED_WIDTH: f64 = 920.0;
const COLLAPSED_HEIGHT: f64 = 54.0;
const OUTER_GUTTER: f64 = 10.0;
const TOP_OFFSET: i32 = 54;
const DICTATION_WINDOW_WIDTH: f64 = 320.0;
const DICTATION_WINDOW_HEIGHT: f64 = 74.0;
const DICTATION_BOTTOM_OFFSET: f64 = 56.0;

#[derive(Debug, Clone)]
struct WindowSnapshot {
    position: PhysicalPosition<i32>,
    size: PhysicalSize<u32>,
}

#[derive(Default)]
pub struct DictationOverlayState {
    snapshot: Mutex<Option<WindowSnapshot>>,
}

#[tauri::command]
pub fn set_island_height(window: WebviewWindow, height: u32) -> Result<(), String> {
    let width = if height as f64 > COLLAPSED_HEIGHT {
        EXPANDED_WIDTH
    } else {
        COLLAPSED_WIDTH
    };
    let size = tauri::LogicalSize::new(
        width + OUTER_GUTTER * 2.0,
        height as f64 + OUTER_GUTTER * 2.0,
    );
    resize_preserving_position(&window, size).map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn set_dictation_overlay_mode(
    window: WebviewWindow,
    state: State<DictationOverlayState>,
    enabled: bool,
) -> Result<(), String> {
    let mut snapshot = state
        .snapshot
        .lock()
        .map_err(|error| format!("Failed to lock Dictation window state: {error}"))?;

    if enabled {
        if snapshot.is_some() {
            return Ok(());
        }
        *snapshot = Some(WindowSnapshot {
            position: window.outer_position().map_err(|error| error.to_string())?,
            size: window.outer_size().map_err(|error| error.to_string())?,
        });
        window
            .set_min_size(None::<tauri::LogicalSize<f64>>)
            .map_err(|error| error.to_string())?;
        window
            .set_min_size(Some(tauri::LogicalSize::new(
                DICTATION_WINDOW_WIDTH,
                DICTATION_WINDOW_HEIGHT,
            )))
            .map_err(|error| error.to_string())?;
        window
            .set_size(tauri::LogicalSize::new(
                DICTATION_WINDOW_WIDTH,
                DICTATION_WINDOW_HEIGHT,
            ))
            .map_err(|error| error.to_string())?;
        position_bottom_center(&window)?;
        return Ok(());
    }

    let Some(previous) = snapshot.take() else {
        return Ok(());
    };
    window
        .set_min_size(None::<tauri::LogicalSize<f64>>)
        .map_err(|error| error.to_string())?;
    window
        .set_size(previous.size)
        .map_err(|error| error.to_string())?;
    window
        .set_position(Position::Physical(previous.position))
        .map_err(|error| error.to_string())?;
    window
        .set_min_size(Some(tauri::LogicalSize::new(
            COLLAPSED_WIDTH,
            COLLAPSED_HEIGHT,
        )))
        .map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn set_island_visible(window: WebviewWindow, visible: bool) -> Result<(), String> {
    if visible {
        window.show().map_err(|error| error.to_string())?;
        window.set_focus().map_err(|error| error.to_string())?;
    } else {
        window.hide().map_err(|error| error.to_string())?;
    }

    Ok(())
}

/// Toggles whether this window's contents can be captured by other apps
/// (screenshots, screen recording, screen sharing).
///
/// On macOS this maps to `NSWindow.sharingType`: `enabled` sets it to
/// `.none`, which excludes the window from `CGWindowListCreateImage` and
/// most window-capture-based recording tools. It does NOT reliably hide the
/// window from capture paths built on ScreenCaptureKit (macOS 15+ Sequoia,
/// used by newer Zoom/Teams/Loom builds), since SCK reads from the
/// compositor framebuffer rather than respecting per-window sharing type.
/// See docs/STEALTH_AND_SCREEN_CAPTURE.md for the full test matrix and the
/// product-copy constraints (never promise "always invisible").
#[tauri::command]
pub fn set_stealth(window: WebviewWindow, enabled: bool) -> Result<(), String> {
    window
        .set_content_protected(enabled)
        .map_err(|error| error.to_string())
}

/// Opens (and focuses) the Settings window. It stays hidden until the user
/// asks for it, since it's a plain window and shouldn't appear on launch
/// alongside the floating island.
#[tauri::command]
pub fn open_settings_window(app: tauri::AppHandle) -> Result<(), String> {
    let Some(window) = app.get_webview_window("settings") else {
        return Err("Settings window not found".to_string());
    };
    window.show().map_err(|error| error.to_string())?;
    window.set_focus().map_err(|error| error.to_string())?;
    Ok(())
}

pub fn setup_island_window(app: &mut App) -> tauri::Result<()> {
    let Some(window) = app.get_webview_window("island") else {
        return Ok(());
    };

    #[cfg(target_os = "macos")]
    setup_macos_panel(&window);

    window.set_size(collapsed_window_size())?;
    position_top_center(&window)?;
    start_click_through_guard(window.clone());

    Ok(())
}

fn position_top_center(window: &WebviewWindow) -> tauri::Result<()> {
    if let Some(monitor) = window.current_monitor()?.or(window.primary_monitor()?) {
        let monitor_position = monitor.position();
        let monitor_size = monitor.size();
        let window_size = window.outer_size()?;

        let monitor_left = monitor_position.x;
        let monitor_top = monitor_position.y;
        let monitor_right = monitor_left + monitor_size.width as i32;
        let monitor_bottom = monitor_top + monitor_size.height as i32;
        let window_width = window_size.width as i32;
        let window_height = window_size.height as i32;

        let centered_x = monitor_left + (monitor_size.width as i32 - window_width) / 2;
        let desired_y = monitor_top + TOP_OFFSET - OUTER_GUTTER.round() as i32;

        let max_x = monitor_right - window_width;
        let max_y = monitor_bottom - window_height;
        let x = clamp_i32(centered_x, monitor_left, max_x.max(monitor_left));
        let y = clamp_i32(desired_y, monitor_top, max_y.max(monitor_top));

        window.set_position(Position::Physical(PhysicalPosition::new(x, y)))?;
    }

    Ok(())
}

fn position_bottom_center(window: &WebviewWindow) -> Result<(), String> {
    let Some(monitor) = window
        .current_monitor()
        .map_err(|error| error.to_string())?
        .or(window
            .primary_monitor()
            .map_err(|error| error.to_string())?)
    else {
        return Ok(());
    };
    let scale = window.scale_factor().map_err(|error| error.to_string())?;
    let monitor_position = monitor.position();
    let monitor_size = monitor.size();
    let window_width = (DICTATION_WINDOW_WIDTH * scale).round() as i32;
    let window_height = (DICTATION_WINDOW_HEIGHT * scale).round() as i32;
    let (x, y) = bottom_center_coordinates(
        monitor_position.x,
        monitor_position.y,
        monitor_size.width as i32,
        monitor_size.height as i32,
        window_width,
        window_height,
        (DICTATION_BOTTOM_OFFSET * scale).round() as i32,
    );
    window
        .set_position(Position::Physical(PhysicalPosition::new(x, y)))
        .map_err(|error| error.to_string())
}

fn bottom_center_coordinates(
    monitor_x: i32,
    monitor_y: i32,
    monitor_width: i32,
    monitor_height: i32,
    window_width: i32,
    window_height: i32,
    bottom_offset: i32,
) -> (i32, i32) {
    (
        monitor_x + (monitor_width - window_width) / 2,
        monitor_y + monitor_height - window_height - bottom_offset,
    )
}

fn resize_preserving_position(
    window: &WebviewWindow,
    size: tauri::LogicalSize<f64>,
) -> tauri::Result<()> {
    let scale = window.scale_factor()?;
    let old_position = window.outer_position()?;
    let old_size = window.outer_size()?;
    let new_width = (size.width * scale).round() as i32;
    let new_height = (size.height * scale).round() as i32;
    let old_center_x = old_position.x + old_size.width as i32 / 2;
    let desired_x = old_center_x - new_width / 2;
    let desired_y = old_position.y;

    window.set_size(size)?;

    if let Some(monitor) = window.current_monitor()?.or(window.primary_monitor()?) {
        let monitor_position = monitor.position();
        let monitor_size = monitor.size();
        let monitor_left = monitor_position.x;
        let monitor_top = monitor_position.y;
        let monitor_right = monitor_left + monitor_size.width as i32;
        let monitor_bottom = monitor_top + monitor_size.height as i32;
        let max_x = monitor_right - new_width;
        let max_y = monitor_bottom - new_height;
        let x = clamp_i32(desired_x, monitor_left, max_x.max(monitor_left));
        let y = clamp_i32(desired_y, monitor_top, max_y.max(monitor_top));

        window.set_position(Position::Physical(PhysicalPosition::new(x, y)))?;
    }

    Ok(())
}

fn clamp_i32(value: i32, min: i32, max: i32) -> i32 {
    value.max(min).min(max)
}

fn collapsed_window_size() -> tauri::LogicalSize<f64> {
    tauri::LogicalSize::new(
        COLLAPSED_WIDTH + OUTER_GUTTER * 2.0,
        COLLAPSED_HEIGHT + OUTER_GUTTER * 2.0,
    )
}

fn start_click_through_guard(window: WebviewWindow) {
    tauri::async_runtime::spawn(async move {
        let mut last_ignore = false;

        loop {
            let should_ignore = should_ignore_cursor_events(&window).unwrap_or(false);
            if should_ignore != last_ignore {
                let _ = window.set_ignore_cursor_events(should_ignore);
                last_ignore = should_ignore;
            }

            tokio::time::sleep(Duration::from_millis(30)).await;
        }
    });
}

fn should_ignore_cursor_events(window: &WebviewWindow) -> Result<bool, String> {
    let size = window.outer_size().map_err(|error| error.to_string())?;
    let position = window.outer_position().map_err(|error| error.to_string())?;
    let cursor = window
        .cursor_position()
        .map_err(|error| error.to_string())?;
    let scale = window.scale_factor().map_err(|error| error.to_string())?;

    let left = position.x as f64;
    let top = position.y as f64;
    let right = left + size.width as f64;
    let bottom = top + size.height as f64;
    let is_inside = cursor.x >= left && cursor.x <= right && cursor.y >= top && cursor.y <= bottom;
    if !is_inside {
        return Ok(false);
    }

    let logical_width = size.width as f64 / scale;
    let logical_height = size.height as f64 / scale;
    let local_x = (cursor.x - left) / scale;
    let local_y = (cursor.y - top) / scale;
    let is_in_outer_gutter = local_x < OUTER_GUTTER
        || local_x > logical_width - OUTER_GUTTER
        || local_y < OUTER_GUTTER
        || local_y > logical_height - OUTER_GUTTER;
    if is_in_outer_gutter {
        return Ok(true);
    }

    Ok(false)
}

#[cfg(target_os = "macos")]
fn setup_macos_panel(window: &WebviewWindow) {
    use tauri_nspanel::{
        cocoa::appkit::NSWindowCollectionBehavior, panel_delegate, WebviewWindowExt,
    };

    let panel = window
        .to_panel()
        .expect("failed to convert window to NSPanel");

    #[allow(non_upper_case_globals)]
    const NSFloatWindowLevel: i32 = 4;
    panel.set_level(NSFloatWindowLevel);

    #[allow(non_upper_case_globals)]
    const NSWindowStyleMaskNonActivatingPanel: i32 = 1 << 7;
    panel.set_style_mask(NSWindowStyleMaskNonActivatingPanel);

    panel.set_collection_behaviour(
        NSWindowCollectionBehavior::NSWindowCollectionBehaviorCanJoinAllSpaces
            | NSWindowCollectionBehavior::NSWindowCollectionBehaviorFullScreenAuxiliary,
    );

    let delegate = panel_delegate!(IslandPanelDelegate {
        window_did_resign_key
    });

    delegate.set_listener(Box::new(move |_delegate_name: String| {}));
    panel.set_delegate(delegate);
}

#[cfg(test)]
mod tests {
    use super::bottom_center_coordinates;

    #[test]
    fn dictation_overlay_is_centered_near_monitor_bottom() {
        assert_eq!(
            bottom_center_coordinates(0, 0, 1512, 982, 320, 74, 56),
            (596, 852)
        );
    }

    #[test]
    fn dictation_overlay_respects_monitor_origin() {
        assert_eq!(
            bottom_center_coordinates(-1920, -120, 1920, 1080, 320, 74, 56),
            (-1120, 830)
        );
    }
}
