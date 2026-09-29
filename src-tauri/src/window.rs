use std::{sync::Mutex, time::Duration};
use tauri::{
    App, AppHandle, Emitter, Manager, PhysicalPosition, Position, State, WebviewUrl,
    WebviewWindow, WebviewWindowBuilder,
};

const COLLAPSED_WIDTH: f64 = 600.0;
const EXPANDED_WIDTH: f64 = 920.0;
const COLLAPSED_HEIGHT: f64 = 54.0;
const EXPANDED_HEIGHT: f64 = 600.0;
const OUTER_GUTTER: f64 = 10.0;
const TOP_OFFSET: i32 = 54;
const NS_WINDOW_STYLE_MASK_RESIZABLE: i32 = 1 << 3;
const NS_WINDOW_STYLE_MASK_NON_ACTIVATING_PANEL: i32 = 1 << 7;

#[derive(Debug, Clone, Copy)]
#[allow(dead_code)]
struct CursorMonitorGeometry {
    source: &'static str,
    cursor_x: f64,
    cursor_y: f64,
    monitor_x: i32,
    monitor_y: i32,
    monitor_width: i32,
    monitor_height: i32,
    work_x: i32,
    work_y: i32,
    work_width: i32,
    work_height: i32,
    scale: f64,
}


#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum IslandPresentationMode {
    Collapsed,
    Expanded,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum IslandReopenAction {
    RestoreExpanded,
    PresentExisting,
}

impl IslandPresentationMode {
    fn from_height(height: u32) -> Self {
        if height as f64 > COLLAPSED_HEIGHT {
            Self::Expanded
        } else {
            Self::Collapsed
        }
    }

    fn is_expanded(self) -> bool {
        self == Self::Expanded
    }
}

#[derive(Debug)]
struct IslandWindowPlacement {
    presentation: IslandPresentationMode,
    meeting_active: bool,
}

impl Default for IslandWindowPlacement {
    fn default() -> Self {
        Self {
            presentation: IslandPresentationMode::Collapsed,
            meeting_active: false,
        }
    }
}

#[derive(Default)]
pub struct IslandWindowState {
    placement: Mutex<IslandWindowPlacement>,
}

#[tauri::command]
pub fn set_island_height(
    window: WebviewWindow,
    state: State<IslandWindowState>,
    height: u32,
) -> Result<(), String> {
    let presentation = IslandPresentationMode::from_height(height);
    let width = if presentation.is_expanded() {
        EXPANDED_WIDTH
    } else {
        COLLAPSED_WIDTH
    };
    let size = tauri::LogicalSize::new(
        width + OUTER_GUTTER * 2.0,
        height as f64 + OUTER_GUTTER * 2.0,
    );
    resize_preserving_position(&window, size).map_err(|error| error.to_string())?;
    let mut placement = state
        .placement
        .lock()
        .map_err(|error| format!("Failed to lock island window state: {error}"))?;
    set_island_window_level(&window, presentation, placement.meeting_active)?;
    placement.presentation = presentation;
    drop(placement);
    set_island_interactive(&window, presentation)?;
    Ok(())
}

#[tauri::command]
pub fn set_island_meeting_active(
    window: WebviewWindow,
    state: State<IslandWindowState>,
    active: bool,
) -> Result<(), String> {
    let mut placement = state
        .placement
        .lock()
        .map_err(|error| format!("Failed to lock island window state: {error}"))?;
    set_island_window_level(&window, placement.presentation, active)?;
    placement.meeting_active = active;
    Ok(())
}

fn should_float_island(presentation: IslandPresentationMode, meeting_active: bool) -> bool {
    presentation == IslandPresentationMode::Collapsed || meeting_active
}

fn island_reopen_action(presentation: IslandPresentationMode) -> IslandReopenAction {
    match presentation {
        IslandPresentationMode::Collapsed => IslandReopenAction::RestoreExpanded,
        IslandPresentationMode::Expanded => IslandReopenAction::PresentExisting,
    }
}

fn island_style_mask(presentation: IslandPresentationMode) -> i32 {
    match presentation {
        IslandPresentationMode::Collapsed => NS_WINDOW_STYLE_MASK_NON_ACTIVATING_PANEL,
        IslandPresentationMode::Expanded => NS_WINDOW_STYLE_MASK_RESIZABLE,
    }
}

fn set_island_window_level(
    window: &WebviewWindow,
    presentation: IslandPresentationMode,
    meeting_active: bool,
) -> Result<(), String> {
    let floating = should_float_island(presentation, meeting_active);

    #[cfg(target_os = "macos")]
    {
        use tauri_nspanel::ManagerExt;

        let panel = window
            .app_handle()
            .get_webview_panel("island")
            .map_err(|error| format!("Failed to get island panel: {error:?}"))?;
        const NS_NORMAL_WINDOW_LEVEL: i32 = 0;
        const NS_FLOATING_WINDOW_LEVEL: i32 = 4;
        panel.set_level(if floating {
            NS_FLOATING_WINDOW_LEVEL
        } else {
            NS_NORMAL_WINDOW_LEVEL
        });
        panel.set_floating_panel(floating);
    }

    #[cfg(not(target_os = "macos"))]
    window
        .set_always_on_top(floating)
        .map_err(|error| error.to_string())?;

    let level = if floating { "floating" } else { "normal" };
    let _ = crate::debug_log::append(&format!(
        "[island] window level={level} presentation={presentation:?} meeting_active={meeting_active}"
    ));
    Ok(())
}

fn set_island_interactive(
    window: &WebviewWindow,
    presentation: IslandPresentationMode,
) -> Result<(), String> {
    window
        .set_resizable(presentation.is_expanded())
        .map_err(|error| error.to_string())?;

    #[cfg(target_os = "macos")]
    {
        use tauri_nspanel::ManagerExt;

        let panel = window
            .app_handle()
            .get_webview_panel("island")
            .map_err(|error| format!("Failed to get island panel: {error:?}"))?;
        if presentation.is_expanded() {
            panel.set_style_mask(island_style_mask(presentation));
            panel.set_becomes_key_only_if_needed(false);
            // The compact panel does not activate Meetly. Order the expanded
            // workspace in front once even when another app is still active.
            // Its normal window level still lets other apps cover it later.
            panel.show();
        } else {
            panel.set_style_mask(island_style_mask(presentation));
            panel.resign_key_window();
            panel.set_becomes_key_only_if_needed(true);
        }
        return Ok(());
    }

    #[cfg(not(target_os = "macos"))]
    {
        window
            .set_focusable(presentation.is_expanded())
            .map_err(|error| error.to_string())?;
        if presentation.is_expanded() {
            window.set_focus().map_err(|error| error.to_string())?;
        }
        Ok(())
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

/// Restores the standard island after it has become hidden or off-screen.
pub fn recover_island_window(app: &AppHandle) -> Result<(), String> {
    let Some(window) = app.get_webview_window("island") else {
        return Err("Meetly window not found".to_string());
    };

    window.unmaximize().map_err(|error| error.to_string())?;
    window
        .set_min_size(None::<tauri::LogicalSize<f64>>)
        .map_err(|error| error.to_string())?;
    window
        .set_size(expanded_window_size())
        .map_err(|error| error.to_string())?;
    let state = app.state::<IslandWindowState>();
    let mut placement = state
        .placement
        .lock()
        .map_err(|error| format!("Failed to lock island window state: {error}"))?;
    let meeting_active = placement.meeting_active;
    set_island_window_level(&window, IslandPresentationMode::Expanded, meeting_active)?;
    placement.presentation = IslandPresentationMode::Expanded;
    drop(placement);
    position_top_center_at_cursor(&window)?;
    window
        .set_min_size(Some(tauri::LogicalSize::new(
            COLLAPSED_WIDTH,
            COLLAPSED_HEIGHT,
        )))
        .map_err(|error| error.to_string())?;
    window.show().map_err(|error| error.to_string())?;
    set_island_interactive(&window, IslandPresentationMode::Expanded)?;
    activate_macos_application()?;
    window.set_focus().map_err(|error| error.to_string())?;
    app.emit("island_visibility_changed", true)
        .map_err(|error| error.to_string())?;
    let _ = crate::debug_log::append("[menu-bar] restored Meetly workspace expanded");
    Ok(())
}

/// Handles an explicit request to reopen Meetly, such as a Dock icon click.
/// An existing workspace keeps its frame; the compact bar opens as a workspace.
pub fn reopen_island_window(app: &AppHandle) -> Result<(), String> {
    let Some(window) = app.get_webview_window("island") else {
        return Err("Meetly window not found".to_string());
    };
    let was_visible = window.is_visible().map_err(|error| error.to_string())?;
    let state = app.state::<IslandWindowState>();
    let (presentation, meeting_active) = {
        let placement = state
            .placement
            .lock()
            .map_err(|error| format!("Failed to lock island window state: {error}"))?;
        (placement.presentation, placement.meeting_active)
    };

    if island_reopen_action(presentation) == IslandReopenAction::RestoreExpanded {
        return recover_island_window(app);
    }

    set_island_window_level(&window, presentation, meeting_active)?;
    window.show().map_err(|error| error.to_string())?;
    set_island_interactive(&window, presentation)?;
    activate_macos_application()?;
    window.set_focus().map_err(|error| error.to_string())?;
    app.emit("island_visibility_changed", true)
        .map_err(|error| error.to_string())?;
    let _ = crate::debug_log::append(&format!(
        "[lifecycle] reopened Meetly workspace was_visible={was_visible}"
    ));
    Ok(())
}

#[cfg(target_os = "macos")]
fn activate_macos_application() -> Result<(), String> {
    use objc2::MainThreadMarker;
    use objc2_app_kit::NSApplication;

    let mtm = MainThreadMarker::new()
        .ok_or_else(|| "Meetly activation must run on the macOS main thread".to_string())?;
    NSApplication::sharedApplication(mtm).activate();
    Ok(())
}

#[cfg(not(target_os = "macos"))]
fn activate_macos_application() -> Result<(), String> {
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
    let Some(island) = app.get_webview_window("island") else {
        return Ok(());
    };

    #[cfg(target_os = "macos")]
    setup_macos_panel(&island);

    island.set_size(collapsed_window_size())?;
    position_top_center(&island)?;
    start_click_through_guard(island.clone());


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
            let work_area = monitor.work_area();
            return Ok(Some(CursorMonitorGeometry {
                source: "appkit",
                cursor_x,
                cursor_y,
                monitor_x: position.x,
                monitor_y: position.y,
                monitor_width: size.width as i32,
                monitor_height: size.height as i32,
                work_x: work_area.position.x,
                work_y: work_area.position.y,
                work_width: work_area.size.width as i32,
                work_height: work_area.size.height as i32,
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
        let work_area = monitor.work_area();
        return Ok(Some(CursorMonitorGeometry {
            source: "tauri",
            cursor_x: cursor.x,
            cursor_y: cursor.y,
            monitor_x: position.x,
            monitor_y: position.y,
            monitor_width: size.width as i32,
            monitor_height: size.height as i32,
            work_x: work_area.position.x,
            work_y: work_area.position.y,
            work_width: work_area.size.width as i32,
            work_height: work_area.size.height as i32,
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
        let work_area = monitor.work_area();
        CursorMonitorGeometry {
            source: "tauri-fallback",
            cursor_x: cursor.x,
            cursor_y: cursor.y,
            monitor_x: position.x,
            monitor_y: position.y,
            monitor_width: size.width as i32,
            monitor_height: size.height as i32,
            work_x: work_area.position.x,
            work_y: work_area.position.y,
            work_width: work_area.size.width as i32,
            work_height: work_area.size.height as i32,
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


fn resize_preserving_position(
    window: &WebviewWindow,
    size: tauri::LogicalSize<f64>,
) -> tauri::Result<()> {
    resize_preserving_position_with_margin(window, size, 0.0)
}

fn resize_preserving_position_with_margin(
    window: &WebviewWindow,
    size: tauri::LogicalSize<f64>,
    logical_margin: f64,
) -> tauri::Result<()> {
    let scale = window.scale_factor()?;
    let old_position = window.outer_position()?;
    let old_size = window.outer_size()?;
    let new_width = (size.width * scale).round() as i32;
    let new_height = (size.height * scale).round() as i32;
    let monitor = window.current_monitor()?.or(window.primary_monitor()?);

    window.set_size(size)?;

    if let Some(monitor) = monitor {
        let margin = (logical_margin * scale).round() as i32;
        let (monitor_origin, monitor_size) = if margin > 0 {
            let work_area = monitor.work_area();
            (
                (work_area.position.x + margin, work_area.position.y + margin),
                (
                    (work_area.size.width as i32 - margin * 2).max(new_width),
                    (work_area.size.height as i32 - margin * 2).max(new_height),
                ),
            )
        } else {
            let position = monitor.position();
            let size = monitor.size();
            (
                (position.x, position.y),
                (size.width as i32, size.height as i32),
            )
        };
        let (x, y) = anchored_resize_coordinates(
            monitor_origin,
            monitor_size,
            (old_position.x, old_position.y),
            (old_size.width as i32, old_size.height as i32),
            (new_width, new_height),
        );

        window.set_position(Position::Physical(PhysicalPosition::new(x, y)))?;
    }

    Ok(())
}

fn anchored_resize_coordinates(
    monitor_origin: (i32, i32),
    monitor_size: (i32, i32),
    old_position: (i32, i32),
    old_size: (i32, i32),
    new_size: (i32, i32),
) -> (i32, i32) {
    let (monitor_left, monitor_top) = monitor_origin;
    let (monitor_width, monitor_height) = monitor_size;
    let (old_x, old_y) = old_position;
    let (old_width, _) = old_size;
    let (new_width, new_height) = new_size;
    let desired_x = old_x + old_width / 2 - new_width / 2;
    let max_x = monitor_left + monitor_width - new_width;
    let max_y = monitor_top + monitor_height - new_height;

    (
        clamp_i32(desired_x, monitor_left, max_x.max(monitor_left)),
        clamp_i32(old_y, monitor_top, max_y.max(monitor_top)),
    )
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

fn expanded_window_size() -> tauri::LogicalSize<f64> {
    tauri::LogicalSize::new(
        EXPANDED_WIDTH + OUTER_GUTTER * 2.0,
        EXPANDED_HEIGHT + OUTER_GUTTER * 2.0,
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

    const NS_FLOATING_WINDOW_LEVEL: i32 = 4;
    panel.set_level(NS_FLOATING_WINDOW_LEVEL);
    panel.set_floating_panel(true);

    panel.set_style_mask(NS_WINDOW_STYLE_MASK_NON_ACTIVATING_PANEL);
    panel.set_becomes_key_only_if_needed(true);

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
        anchored_resize_coordinates, expanded_window_size, island_reopen_action,
        island_style_mask, should_float_island,
        IslandPresentationMode, IslandReopenAction, EXPANDED_HEIGHT, EXPANDED_WIDTH,
        NS_WINDOW_STYLE_MASK_NON_ACTIVATING_PANEL, NS_WINDOW_STYLE_MASK_RESIZABLE, OUTER_GUTTER,
    };

    #[test]
    fn island_becomes_interactive_only_above_collapsed_height() {
        assert_eq!(
            IslandPresentationMode::from_height(54),
            IslandPresentationMode::Collapsed
        );
        assert_eq!(
            IslandPresentationMode::from_height(55),
            IslandPresentationMode::Expanded
        );
        assert!(IslandPresentationMode::from_height(600).is_expanded());
    }

    #[test]
    fn menu_recovery_uses_expanded_workspace_dimensions() {
        let size = expanded_window_size();

        assert_eq!(size.width, EXPANDED_WIDTH + OUTER_GUTTER * 2.0);
        assert_eq!(size.height, EXPANDED_HEIGHT + OUTER_GUTTER * 2.0);
    }

    #[test]
    fn island_floats_only_when_compact_or_meeting_is_active() {
        assert!(should_float_island(
            IslandPresentationMode::Collapsed,
            false
        ));
        assert!(should_float_island(IslandPresentationMode::Collapsed, true));
        assert!(!should_float_island(
            IslandPresentationMode::Expanded,
            false
        ));
        assert!(should_float_island(IslandPresentationMode::Expanded, true));
    }

    #[test]
    fn dock_reopen_expands_the_bar_but_preserves_an_existing_workspace() {
        assert_eq!(
            island_reopen_action(IslandPresentationMode::Collapsed),
            IslandReopenAction::RestoreExpanded
        );
        assert_eq!(
            island_reopen_action(IslandPresentationMode::Expanded),
            IslandReopenAction::PresentExisting
        );
    }

    #[test]
    fn compact_is_non_activating_but_workspace_uses_an_activating_style() {
        assert_eq!(
            island_style_mask(IslandPresentationMode::Collapsed),
            NS_WINDOW_STYLE_MASK_NON_ACTIVATING_PANEL
        );
        assert_eq!(
            island_style_mask(IslandPresentationMode::Expanded),
            NS_WINDOW_STYLE_MASK_RESIZABLE
        );
    }

    #[test]
    fn manual_resize_preserves_top_and_horizontal_center() {
        assert_eq!(
            anchored_resize_coordinates((0, 0), (1512, 982), (700, 420), (480, 300), (480, 356),),
            (700, 420)
        );
        assert_eq!(
            anchored_resize_coordinates((0, 0), (1512, 982), (700, 420), (480, 300), (720, 680),),
            (580, 302)
        );
    }

    #[test]
    fn manual_resize_clamps_to_negative_origin_monitor() {
        assert_eq!(
            anchored_resize_coordinates(
                (-1920, -120),
                (1920, 1080),
                (-1900, -100),
                (480, 300),
                (720, 680),
            ),
            (-1920, -100)
        );
    }
}
