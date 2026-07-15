use std::{sync::Mutex, time::Duration};
use tauri::{
    App, AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, Position, State, WebviewUrl,
    WebviewWindow, WebviewWindowBuilder,
};

const COLLAPSED_WIDTH: f64 = 600.0;
const EXPANDED_WIDTH: f64 = 920.0;
const COLLAPSED_HEIGHT: f64 = 54.0;
const OUTER_GUTTER: f64 = 10.0;
const TOP_OFFSET: i32 = 54;
const COMPACT_OVERLAY_WIDTH: f64 = 320.0;
const COMPACT_OVERLAY_HEIGHT: f64 = 68.0;
const DICTATION_BOTTOM_OFFSET: f64 = 56.0;

#[derive(Debug, Clone)]
struct WindowSnapshot {
    position: PhysicalPosition<i32>,
    size: PhysicalSize<u32>,
}

#[derive(Default)]
pub struct DictationOverlayState {
    inner: Mutex<OverlayWindowState>,
}

#[derive(Default)]
struct OverlayWindowState {
    snapshot: Option<WindowSnapshot>,
    cursor_monitor: Option<CursorMonitorGeometry>,
}

#[derive(Debug, Clone, Copy)]
struct CursorMonitorGeometry {
    source: &'static str,
    cursor_x: f64,
    cursor_y: f64,
    monitor_x: i32,
    monitor_y: i32,
    monitor_width: i32,
    monitor_height: i32,
    scale: f64,
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
    app: AppHandle,
    window: WebviewWindow,
    state: State<DictationOverlayState>,
    enabled: bool,
    width: Option<f64>,
    height: Option<f64>,
) -> Result<(), String> {
    if !enabled && crate::dictation::has_active_run(&app) {
        let _ = crate::debug_log::append("[overlay] ignored restore while voice run is active");
        return Ok(());
    }
    set_overlay_mode(&window, &state, enabled, width, height)
}

fn set_overlay_mode(
    window: &WebviewWindow,
    state: &DictationOverlayState,
    enabled: bool,
    width: Option<f64>,
    height: Option<f64>,
) -> Result<(), String> {
    let mut overlay = state
        .inner
        .lock()
        .map_err(|error| format!("Failed to lock Dictation window state: {error}"))?;

    if enabled {
        if overlay.snapshot.is_none() {
            overlay.snapshot = Some(capture_window_snapshot(window)?);
        }
        if overlay.cursor_monitor.is_none() {
            overlay.cursor_monitor = cursor_monitor_geometry(window)?;
        }
        window
            .set_min_size(None::<tauri::LogicalSize<f64>>)
            .map_err(|error| error.to_string())?;
        position_overlay(
            window,
            overlay.cursor_monitor,
            width.unwrap_or(COMPACT_OVERLAY_WIDTH),
            height.unwrap_or(COMPACT_OVERLAY_HEIGHT),
        )?;
        return Ok(());
    }

    overlay.cursor_monitor = None;
    let Some(previous) = overlay.snapshot.take() else {
        return Ok(());
    };
    window
        .set_min_size(None::<tauri::LogicalSize<f64>>)
        .map_err(|error| error.to_string())?;
    let restore_size = normalized_restore_size(
        previous.size,
        monitor_scale_at_position(window, previous.position)?,
    );
    window
        .set_size(restore_size)
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
    let _ = crate::debug_log::append(&format!(
        "[overlay] restored snapshot_size={}x{} restore_size={}x{} position=({},{})",
        previous.size.width,
        previous.size.height,
        restore_size.width,
        restore_size.height,
        previous.position.x,
        previous.position.y
    ));
    Ok(())
}

fn capture_window_snapshot(window: &WebviewWindow) -> Result<WindowSnapshot, String> {
    let snapshot = WindowSnapshot {
        position: window.outer_position().map_err(|error| error.to_string())?,
        size: window.outer_size().map_err(|error| error.to_string())?,
    };
    let _ = crate::debug_log::append(&format!(
        "[overlay] captured snapshot size={}x{} position=({},{})",
        snapshot.size.width, snapshot.size.height, snapshot.position.x, snapshot.position.y
    ));
    Ok(snapshot)
}

fn monitor_scale_at_position(
    window: &WebviewWindow,
    position: PhysicalPosition<i32>,
) -> Result<f64, String> {
    let monitors = window
        .available_monitors()
        .map_err(|error| error.to_string())?;
    Ok(monitors
        .iter()
        .find(|monitor| {
            let origin = monitor.position();
            let size = monitor.size();
            monitor_contains_cursor(
                origin.x,
                origin.y,
                size.width as i32,
                size.height as i32,
                position.x as f64,
                position.y as f64,
            )
        })
        .map(|monitor| monitor.scale_factor())
        .unwrap_or(window.scale_factor().map_err(|error| error.to_string())?))
}

fn normalized_restore_size(size: PhysicalSize<u32>, scale: f64) -> PhysicalSize<u32> {
    let collapsed = collapsed_window_size();
    let logical_width = size.width as f64 / scale;
    if logical_width + 1.0 < collapsed.width {
        return PhysicalSize::new(
            (collapsed.width * scale).round() as u32,
            (collapsed.height * scale).round() as u32,
        );
    }
    size
}

pub(crate) fn prepare_dictation_overlay(app: &AppHandle) {
    prepare_compact_overlay(app, "dictation");
}

pub(crate) fn prepare_voice_ask_overlay(app: &AppHandle) {
    prepare_compact_overlay(app, "voice-ask");
}

fn prepare_compact_overlay(app: &AppHandle, kind: &str) {
    let app_for_task = app.clone();
    let kind = kind.to_string();
    let task_kind = kind.clone();
    if let Err(error) = app.run_on_main_thread(move || {
        prepare_compact_overlay_on_main(&app_for_task, &task_kind);
    }) {
        let _ = crate::debug_log::append(&format!(
            "[overlay] failed to schedule prepare kind={kind} error={error}"
        ));
    }
}

fn prepare_compact_overlay_on_main(app: &AppHandle, kind: &str) {
    let Some(window) = app.get_webview_window("island") else {
        return;
    };
    let state = app.state::<DictationOverlayState>();
    let result = (|| {
        let mut overlay = state
            .inner
            .lock()
            .map_err(|error| format!("Failed to lock Dictation window state: {error}"))?;
        if overlay.snapshot.is_none() {
            overlay.snapshot = Some(capture_window_snapshot(&window)?);
        }
        overlay.cursor_monitor = cursor_monitor_geometry(&window)?;
        window
            .set_min_size(None::<tauri::LogicalSize<f64>>)
            .map_err(|error| error.to_string())?;
        position_overlay(
            &window,
            overlay.cursor_monitor,
            COMPACT_OVERLAY_WIDTH,
            COMPACT_OVERLAY_HEIGHT,
        )
    })();

    if let Err(error) = result {
        let _ = crate::debug_log::append(&format!(
            "[overlay] prepare failed kind={kind} error={error}"
        ));
    }
}

#[tauri::command]
pub fn set_island_visible(window: WebviewWindow, visible: bool) -> Result<(), String> {
    if visible {
        window.show().map_err(|error| error.to_string())?;
        window.set_focus().map_err(|error| error.to_string())?;
    } else {
        window.hide().map_err(|error| error.to_string())?;
    }

    window
        .emit("island_visibility_changed", visible)
        .map_err(|error| error.to_string())?;

    Ok(())
}

/// Restores the standard island after it has become hidden, off-screen, or
/// stuck in a compact voice overlay. Active voice runs keep their overlay
/// geometry so recovering the window cannot interrupt recording.
pub fn recover_island_window(app: &AppHandle) -> Result<(), String> {
    let Some(window) = app.get_webview_window("island") else {
        return Err("Meetly window not found".to_string());
    };

    if !crate::dictation::has_active_run(app) {
        let state = app.state::<DictationOverlayState>();
        let mut overlay = state
            .inner
            .lock()
            .map_err(|error| format!("Failed to lock Dictation window state: {error}"))?;
        overlay.snapshot = None;
        overlay.cursor_monitor = None;
        drop(overlay);

        window
            .set_min_size(None::<tauri::LogicalSize<f64>>)
            .map_err(|error| error.to_string())?;
        window
            .set_size(collapsed_window_size())
            .map_err(|error| error.to_string())?;
        position_top_center_at_cursor(&window)?;
        window
            .set_min_size(Some(tauri::LogicalSize::new(
                COLLAPSED_WIDTH,
                COLLAPSED_HEIGHT,
            )))
            .map_err(|error| error.to_string())?;
    }

    window.show().map_err(|error| error.to_string())?;
    window.set_focus().map_err(|error| error.to_string())?;
    app.emit("island_visibility_changed", true)
        .map_err(|error| error.to_string())?;
    let _ = crate::debug_log::append("[menu-bar] restored Meetly island");
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
    let window = if let Some(window) = app.get_webview_window("settings") {
        window
    } else {
        WebviewWindowBuilder::new(&app, "settings", WebviewUrl::App("settings.html".into()))
            .title("Meetly Settings")
            .inner_size(480.0, 560.0)
            .min_inner_size(420.0, 480.0)
            .center()
            .build()
            .map_err(|error| error.to_string())?
    };
    window.show().map_err(|error| error.to_string())?;
    window.unminimize().map_err(|error| error.to_string())?;
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

fn position_top_center_at_cursor(window: &WebviewWindow) -> Result<(), String> {
    let Some(geometry) = cursor_monitor_geometry(window)? else {
        return position_top_center(window).map_err(|error| error.to_string());
    };
    let window_size = window.outer_size().map_err(|error| error.to_string())?;
    let window_width = window_size.width as i32;
    let window_height = window_size.height as i32;
    let centered_x = geometry.monitor_x + (geometry.monitor_width - window_width) / 2;
    let desired_y = geometry.monitor_y + TOP_OFFSET - OUTER_GUTTER.round() as i32;
    let max_x = geometry.monitor_x + geometry.monitor_width - window_width;
    let max_y = geometry.monitor_y + geometry.monitor_height - window_height;
    let x = clamp_i32(
        centered_x,
        geometry.monitor_x,
        max_x.max(geometry.monitor_x),
    );
    let y = clamp_i32(desired_y, geometry.monitor_y, max_y.max(geometry.monitor_y));

    window
        .set_position(Position::Physical(PhysicalPosition::new(x, y)))
        .map_err(|error| error.to_string())
}

fn position_overlay(
    window: &WebviewWindow,
    geometry: Option<CursorMonitorGeometry>,
    logical_width: f64,
    logical_height: f64,
) -> Result<(), String> {
    let Some(geometry) = geometry else {
        let _ = crate::debug_log::append("[overlay] no monitor geometry available");
        return Ok(());
    };

    let window_width = (logical_width * geometry.scale).round() as i32;
    let window_height = (logical_height * geometry.scale).round() as i32;
    window
        .set_size(PhysicalSize::new(
            window_width.max(1) as u32,
            window_height.max(1) as u32,
        ))
        .map_err(|error| error.to_string())?;
    let (x, y) = bottom_center_coordinates(
        geometry.monitor_x,
        geometry.monitor_y,
        geometry.monitor_width,
        geometry.monitor_height,
        window_width,
        window_height,
        (DICTATION_BOTTOM_OFFSET * geometry.scale).round() as i32,
    );
    window
        .set_position(Position::Physical(PhysicalPosition::new(x, y)))
        .map_err(|error| error.to_string())?;
    let _ = crate::debug_log::append(&format!(
        "[overlay] positioned source={} cursor=({:.0},{:.0}) monitor=({},{},{}x{}) scale={:.2} window={}x{} position=({},{})",
        geometry.source,
        geometry.cursor_x,
        geometry.cursor_y,
        geometry.monitor_x,
        geometry.monitor_y,
        geometry.monitor_width,
        geometry.monitor_height,
        geometry.scale,
        window_width,
        window_height,
        x,
        y
    ));
    Ok(())
}

fn cursor_monitor_geometry(
    window: &WebviewWindow,
) -> Result<Option<CursorMonitorGeometry>, String> {
    #[cfg(target_os = "macos")]
    if let Some((cursor_x, cursor_y, physical_width, physical_height, scale)) =
        macos_cursor_screen()
    {
        let monitors = window
            .available_monitors()
            .map_err(|error| error.to_string())?;
        if let Some(monitor) = monitors.iter().find(|monitor| {
            monitor.size().width.abs_diff(physical_width) <= 2
                && monitor.size().height.abs_diff(physical_height) <= 2
                && (monitor.scale_factor() - scale).abs() < 0.01
        }) {
            let position = monitor.position();
            let size = monitor.size();
            return Ok(Some(CursorMonitorGeometry {
                source: "appkit",
                cursor_x,
                cursor_y,
                monitor_x: position.x,
                monitor_y: position.y,
                monitor_width: size.width as i32,
                monitor_height: size.height as i32,
                scale: monitor.scale_factor(),
            }));
        }
        let _ = crate::debug_log::append(&format!(
            "[overlay] AppKit cursor screen unmatched size={}x{} scale={:.2}",
            physical_width, physical_height, scale
        ));
    }

    let cursor = window
        .cursor_position()
        .map_err(|error| error.to_string())?;
    let monitors = window
        .available_monitors()
        .map_err(|error| error.to_string())?;

    if let Some(monitor) = monitors.iter().find(|monitor| {
        let position = monitor.position();
        let size = monitor.size();
        monitor_contains_cursor(
            position.x,
            position.y,
            size.width as i32,
            size.height as i32,
            cursor.x,
            cursor.y,
        )
    }) {
        let position = monitor.position();
        let size = monitor.size();
        return Ok(Some(CursorMonitorGeometry {
            source: "tauri",
            cursor_x: cursor.x,
            cursor_y: cursor.y,
            monitor_x: position.x,
            monitor_y: position.y,
            monitor_width: size.width as i32,
            monitor_height: size.height as i32,
            scale: monitor.scale_factor(),
        }));
    }

    let fallback = window
        .current_monitor()
        .map_err(|error| error.to_string())?
        .or(window
            .primary_monitor()
            .map_err(|error| error.to_string())?);
    Ok(fallback.map(|monitor| {
        let position = monitor.position();
        let size = monitor.size();
        CursorMonitorGeometry {
            source: "tauri-fallback",
            cursor_x: cursor.x,
            cursor_y: cursor.y,
            monitor_x: position.x,
            monitor_y: position.y,
            monitor_width: size.width as i32,
            monitor_height: size.height as i32,
            scale: monitor.scale_factor(),
        }
    }))
}

#[cfg(target_os = "macos")]
fn macos_cursor_screen() -> Option<(f64, f64, u32, u32, f64)> {
    use objc2::MainThreadMarker;
    use objc2_app_kit::{NSEvent, NSScreen};

    let mtm = MainThreadMarker::new()?;
    let cursor = NSEvent::mouseLocation();
    for screen in NSScreen::screens(mtm) {
        let frame = screen.frame();
        let within_x = cursor.x >= frame.origin.x && cursor.x < frame.origin.x + frame.size.width;
        let within_y = cursor.y >= frame.origin.y && cursor.y < frame.origin.y + frame.size.height;
        if within_x && within_y {
            let scale = screen.backingScaleFactor();
            return Some((
                cursor.x,
                cursor.y,
                (frame.size.width * scale).round() as u32,
                (frame.size.height * scale).round() as u32,
                scale,
            ));
        }
    }
    None
}

fn monitor_contains_cursor(
    monitor_x: i32,
    monitor_y: i32,
    monitor_width: i32,
    monitor_height: i32,
    cursor_x: f64,
    cursor_y: f64,
) -> bool {
    cursor_x >= monitor_x as f64
        && cursor_x < (monitor_x + monitor_width) as f64
        && cursor_y >= monitor_y as f64
        && cursor_y < (monitor_y + monitor_height) as f64
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
#[allow(deprecated, unexpected_cfgs)]
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
    use super::{
        bottom_center_coordinates, monitor_contains_cursor, normalized_restore_size,
        COMPACT_OVERLAY_HEIGHT, COMPACT_OVERLAY_WIDTH,
    };
    use tauri::PhysicalSize;

    #[test]
    fn dictation_overlay_is_centered_near_monitor_bottom() {
        assert_eq!(
            bottom_center_coordinates(
                0,
                0,
                1512,
                982,
                COMPACT_OVERLAY_WIDTH as i32,
                COMPACT_OVERLAY_HEIGHT as i32,
                56
            ),
            (596, 858)
        );
    }

    #[test]
    fn dictation_overlay_respects_monitor_origin() {
        assert_eq!(
            bottom_center_coordinates(
                -1920,
                -120,
                1920,
                1080,
                COMPACT_OVERLAY_WIDTH as i32,
                COMPACT_OVERLAY_HEIGHT as i32,
                56
            ),
            (-1120, 836)
        );
    }

    #[test]
    fn overlay_selects_monitor_containing_cursor() {
        assert!(monitor_contains_cursor(
            -1920, -120, 1920, 1080, -800.0, 400.0
        ));
        assert!(!monitor_contains_cursor(
            -1920, -120, 1920, 1080, 300.0, 400.0
        ));
        assert!(monitor_contains_cursor(0, 0, 1512, 982, 300.0, 400.0));
    }

    #[test]
    fn compact_snapshot_restores_to_collapsed_island_size() {
        assert_eq!(
            normalized_restore_size(PhysicalSize::new(320, 68), 1.0),
            PhysicalSize::new(620, 74)
        );
        assert_eq!(
            normalized_restore_size(PhysicalSize::new(760, 148), 2.0),
            PhysicalSize::new(1240, 148)
        );
    }

    #[test]
    fn expanded_snapshot_size_is_preserved() {
        assert_eq!(
            normalized_restore_size(PhysicalSize::new(1880, 1240), 2.0),
            PhysicalSize::new(1880, 1240)
        );
    }
}
