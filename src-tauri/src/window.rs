use serde::{Deserialize, Serialize};
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
const EXPANDED_OVERLAY_WIDTH: f64 = 720.0;
const EXPANDED_OVERLAY_HEIGHT: f64 = 680.0;
const EXPANDED_OVERLAY_MIN_WIDTH: f64 = 560.0;
const EXPANDED_OVERLAY_MIN_HEIGHT: f64 = 480.0;
const EXPANDED_OVERLAY_MARGIN: f64 = 24.0;
const DICTATION_BOTTOM_OFFSET: f64 = 56.0;

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum VoiceOverlayPresentationMode {
    Hidden,
    #[default]
    Compact,
    Expanded,
}

#[derive(Debug)]
struct VoiceOverlayPlacement {
    cursor_monitor: Option<CursorMonitorGeometry>,
    presentation: VoiceOverlayPresentationMode,
    last_non_hidden: VoiceOverlayPresentationMode,
    manually_positioned: bool,
}

impl Default for VoiceOverlayPlacement {
    fn default() -> Self {
        Self {
            cursor_monitor: None,
            presentation: VoiceOverlayPresentationMode::Hidden,
            last_non_hidden: VoiceOverlayPresentationMode::Compact,
            manually_positioned: false,
        }
    }
}

impl VoiceOverlayPlacement {
    fn begin_run(&mut self, cursor_monitor: Option<CursorMonitorGeometry>) {
        self.cursor_monitor = cursor_monitor;
        self.manually_positioned = false;
    }

    fn set_presentation(&mut self, presentation: VoiceOverlayPresentationMode) {
        self.presentation = presentation;
        if presentation != VoiceOverlayPresentationMode::Hidden {
            self.last_non_hidden = presentation;
        }
    }
}

#[derive(Default)]
pub struct VoiceOverlayState {
    placement: Mutex<VoiceOverlayPlacement>,
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
    work_x: i32,
    work_y: i32,
    work_width: i32,
    work_height: i32,
    scale: f64,
}

#[derive(Debug, Clone, Copy, PartialEq)]
struct VoiceOverlayDimensions {
    width: f64,
    height: f64,
    min_width: Option<f64>,
    min_height: Option<f64>,
    margin: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum IslandPresentationMode {
    Collapsed,
    Expanded,
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

#[tauri::command]
pub fn set_island_height(window: WebviewWindow, height: u32) -> Result<(), String> {
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
    set_island_interactive(&window, presentation)?;
    Ok(())
}

fn set_island_interactive(
    window: &WebviewWindow,
    presentation: IslandPresentationMode,
) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        use tauri_nspanel::ManagerExt;

        let panel = window
            .app_handle()
            .get_webview_panel("island")
            .map_err(|error| format!("Failed to get island panel: {error:?}"))?;
        if presentation.is_expanded() {
            panel.set_becomes_key_only_if_needed(false);
            panel.make_key_and_order_front(None);
        } else {
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
pub fn set_voice_overlay_presentation_mode(
    app: AppHandle,
    state: State<VoiceOverlayState>,
    presentation_mode: VoiceOverlayPresentationMode,
    width: Option<f64>,
    height: Option<f64>,
) -> Result<(), String> {
    if presentation_mode == VoiceOverlayPresentationMode::Hidden
        && crate::dictation::has_active_run(&app)
    {
        let _ = crate::debug_log::append("[voice-overlay] ignored hide while voice run is active");
        return Ok(());
    }
    let Some(window) = app.get_webview_window("voice-overlay") else {
        return Err("Voice overlay window not found".to_string());
    };

    let mut placement = state
        .placement
        .lock()
        .map_err(|error| format!("Failed to lock voice overlay state: {error}"))?;

    if presentation_mode != VoiceOverlayPresentationMode::Hidden {
        if placement.cursor_monitor.is_none() {
            placement.cursor_monitor = cursor_monitor_geometry(&window)?;
        }
        let dimensions = resolve_voice_overlay_dimensions(
            presentation_mode,
            width,
            height,
            placement.cursor_monitor,
        );
        configure_voice_overlay_window(&app, &window, presentation_mode, dimensions)?;
        if placement.manually_positioned {
            resize_preserving_position_with_margin(
                &window,
                tauri::LogicalSize::new(dimensions.width, dimensions.height),
                dimensions.margin,
            )
            .map_err(|error| error.to_string())?;
        } else {
            position_overlay(
                &window,
                placement.cursor_monitor,
                dimensions.width,
                dimensions.height,
                dimensions.margin,
            )?;
        }
        placement.set_presentation(presentation_mode);
        window.show().map_err(|error| error.to_string())?;
        activate_voice_overlay_window(&app, &window, presentation_mode)?;
        return Ok(());
    }

    placement.set_presentation(VoiceOverlayPresentationMode::Hidden);
    deactivate_voice_overlay_window(&app);
    window.hide().map_err(|error| error.to_string())?;
    let _ = crate::debug_log::append("[voice-overlay] hidden");
    Ok(())
}

#[tauri::command]
pub fn mark_voice_overlay_manually_positioned(
    app: AppHandle,
    state: State<VoiceOverlayState>,
) -> Result<(), String> {
    let Some(window) = app.get_webview_window("voice-overlay") else {
        return Err("Voice overlay window not found".to_string());
    };
    let destination_monitor = cursor_monitor_geometry(&window)?;
    let position = window.outer_position().map_err(|error| error.to_string())?;
    let mut placement = state
        .placement
        .lock()
        .map_err(|error| format!("Failed to lock voice overlay state: {error}"))?;
    placement.cursor_monitor = destination_monitor;
    placement.manually_positioned = true;
    let _ = crate::debug_log::append(&format!(
        "[voice-overlay] manually positioned x={} y={}",
        position.x, position.y
    ));
    Ok(())
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
    let Some(window) = app.get_webview_window("voice-overlay") else {
        return;
    };
    let state = app.state::<VoiceOverlayState>();
    let result = (|| {
        let mut placement = state
            .placement
            .lock()
            .map_err(|error| format!("Failed to lock voice overlay state: {error}"))?;
        placement.begin_run(cursor_monitor_geometry(&window)?);
        configure_voice_overlay_window(
            app,
            &window,
            VoiceOverlayPresentationMode::Compact,
            resolve_voice_overlay_dimensions(
                VoiceOverlayPresentationMode::Compact,
                None,
                None,
                placement.cursor_monitor,
            ),
        )?;
        position_overlay(
            &window,
            placement.cursor_monitor,
            COMPACT_OVERLAY_WIDTH,
            COMPACT_OVERLAY_HEIGHT,
            0.0,
        )?;
        placement.set_presentation(VoiceOverlayPresentationMode::Compact);
        window.show().map_err(|error| error.to_string())
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

/// Restores the standard island after it has become hidden or off-screen.
pub fn recover_island_window(app: &AppHandle) -> Result<(), String> {
    let Some(window) = app.get_webview_window("island") else {
        return Err("Meetly window not found".to_string());
    };

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
    let Some(island) = app.get_webview_window("island") else {
        return Ok(());
    };

    #[cfg(target_os = "macos")]
    setup_macos_panel(&island);

    island.set_size(collapsed_window_size())?;
    position_top_center(&island)?;
    start_click_through_guard(island.clone());

    if let Some(voice_overlay) = app.get_webview_window("voice-overlay") {
        #[cfg(target_os = "macos")]
        setup_macos_panel(&voice_overlay);

        voice_overlay.set_size(tauri::LogicalSize::new(
            COMPACT_OVERLAY_WIDTH,
            COMPACT_OVERLAY_HEIGHT,
        ))?;
        voice_overlay.hide()?;
        start_click_through_guard(voice_overlay);
    }

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

fn resolve_voice_overlay_dimensions(
    presentation: VoiceOverlayPresentationMode,
    requested_width: Option<f64>,
    requested_height: Option<f64>,
    geometry: Option<CursorMonitorGeometry>,
) -> VoiceOverlayDimensions {
    if presentation != VoiceOverlayPresentationMode::Expanded {
        return VoiceOverlayDimensions {
            width: requested_width.unwrap_or(COMPACT_OVERLAY_WIDTH),
            height: requested_height.unwrap_or(COMPACT_OVERLAY_HEIGHT),
            min_width: None,
            min_height: None,
            margin: 0.0,
        };
    }

    let (max_width, max_height) = geometry
        .map(|geometry| {
            let logical_work_width = geometry.work_width as f64 / geometry.scale;
            let logical_work_height = geometry.work_height as f64 / geometry.scale;
            (
                (logical_work_width - EXPANDED_OVERLAY_MARGIN * 2.0).max(1.0),
                (logical_work_height - EXPANDED_OVERLAY_MARGIN * 2.0).max(1.0),
            )
        })
        .unwrap_or((EXPANDED_OVERLAY_WIDTH, EXPANDED_OVERLAY_HEIGHT));
    let min_width = EXPANDED_OVERLAY_MIN_WIDTH.min(max_width);
    let min_height = EXPANDED_OVERLAY_MIN_HEIGHT.min(max_height);
    let width = requested_width
        .unwrap_or(EXPANDED_OVERLAY_WIDTH)
        .max(min_width)
        .min(max_width);
    let height = requested_height
        .unwrap_or(EXPANDED_OVERLAY_HEIGHT)
        .max(min_height)
        .min(max_height);

    VoiceOverlayDimensions {
        width,
        height,
        min_width: Some(min_width),
        min_height: Some(min_height),
        margin: EXPANDED_OVERLAY_MARGIN,
    }
}

fn configure_voice_overlay_window(
    app: &AppHandle,
    window: &WebviewWindow,
    presentation: VoiceOverlayPresentationMode,
    dimensions: VoiceOverlayDimensions,
) -> Result<(), String> {
    if presentation == VoiceOverlayPresentationMode::Expanded {
        window
            .set_min_size(Some(tauri::LogicalSize::new(
                dimensions.min_width.unwrap_or(EXPANDED_OVERLAY_MIN_WIDTH),
                dimensions.min_height.unwrap_or(EXPANDED_OVERLAY_MIN_HEIGHT),
            )))
            .map_err(|error| error.to_string())?;
        window
            .set_resizable(true)
            .map_err(|error| error.to_string())?;
        // tauri-nspanel replaces Tao's NSWindow class. Tao's macOS
        // set_focusable implementation then panics while looking up its ivar.
        #[cfg(not(target_os = "macos"))]
        window
            .set_focusable(true)
            .map_err(|error| error.to_string())?;
        return Ok(());
    }

    deactivate_voice_overlay_window(app);
    window
        .set_min_size(None::<tauri::Size>)
        .map_err(|error| error.to_string())?;
    window
        .set_resizable(false)
        .map_err(|error| error.to_string())?;
    #[cfg(not(target_os = "macos"))]
    window
        .set_focusable(false)
        .map_err(|error| error.to_string())?;
    Ok(())
}

fn activate_voice_overlay_window(
    app: &AppHandle,
    window: &WebviewWindow,
    presentation: VoiceOverlayPresentationMode,
) -> Result<(), String> {
    if presentation != VoiceOverlayPresentationMode::Expanded {
        return Ok(());
    }

    #[cfg(target_os = "macos")]
    {
        use tauri_nspanel::ManagerExt;
        if let Ok(panel) = app.get_webview_panel("voice-overlay") {
            panel.set_becomes_key_only_if_needed(false);
            panel.make_key_and_order_front(None);
            return Ok(());
        }
    }

    window.set_focus().map_err(|error| error.to_string())
}

fn deactivate_voice_overlay_window(app: &AppHandle) {
    #[cfg(target_os = "macos")]
    {
        use tauri_nspanel::ManagerExt;
        if let Ok(panel) = app.get_webview_panel("voice-overlay") {
            panel.resign_key_window();
            panel.set_becomes_key_only_if_needed(true);
        }
    }

    #[cfg(not(target_os = "macos"))]
    let _ = app;
}

fn position_overlay(
    window: &WebviewWindow,
    geometry: Option<CursorMonitorGeometry>,
    logical_width: f64,
    logical_height: f64,
    logical_margin: f64,
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
    let margin = (logical_margin * geometry.scale).round() as i32;
    let (x, y) = bottom_center_coordinates(
        geometry.work_x + margin,
        geometry.work_y + margin,
        (geometry.work_width - margin * 2).max(window_width),
        (geometry.work_height - margin * 2).max(window_height),
        window_width,
        window_height,
        if logical_margin > 0.0 {
            0
        } else {
            (DICTATION_BOTTOM_OFFSET * geometry.scale).round() as i32
        },
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
        anchored_resize_coordinates, bottom_center_coordinates, monitor_contains_cursor,
        resolve_voice_overlay_dimensions, CursorMonitorGeometry, IslandPresentationMode,
        VoiceOverlayPlacement, VoiceOverlayPresentationMode, COMPACT_OVERLAY_HEIGHT,
        COMPACT_OVERLAY_WIDTH,
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

    #[test]
    fn presentation_tracks_last_non_hidden_mode() {
        let mut placement = VoiceOverlayPlacement::default();
        assert_eq!(placement.presentation, VoiceOverlayPresentationMode::Hidden);
        assert_eq!(
            placement.last_non_hidden,
            VoiceOverlayPresentationMode::Compact
        );

        placement.set_presentation(VoiceOverlayPresentationMode::Expanded);
        placement.set_presentation(VoiceOverlayPresentationMode::Hidden);

        assert_eq!(placement.presentation, VoiceOverlayPresentationMode::Hidden);
        assert_eq!(
            placement.last_non_hidden,
            VoiceOverlayPresentationMode::Expanded
        );
        assert_eq!(
            serde_json::to_value(VoiceOverlayPresentationMode::Expanded).unwrap(),
            "expanded"
        );
    }

    #[test]
    fn new_voice_run_forgets_the_previous_drag_position() {
        let mut placement = VoiceOverlayPlacement {
            manually_positioned: true,
            ..VoiceOverlayPlacement::default()
        };
        let monitor = CursorMonitorGeometry {
            source: "test",
            cursor_x: -800.0,
            cursor_y: 100.0,
            monitor_x: -1920,
            monitor_y: -120,
            monitor_width: 1920,
            monitor_height: 1080,
            work_x: -1920,
            work_y: -120,
            work_width: 1920,
            work_height: 1055,
            scale: 1.0,
        };

        placement.begin_run(Some(monitor));

        assert!(!placement.manually_positioned);
        assert_eq!(placement.cursor_monitor.unwrap().monitor_x, -1920);
    }

    #[test]
    fn expanded_dimensions_use_target_and_minimum_on_normal_monitor() {
        let geometry = CursorMonitorGeometry {
            source: "test",
            cursor_x: 100.0,
            cursor_y: 100.0,
            monitor_x: 0,
            monitor_y: 0,
            monitor_width: 3024,
            monitor_height: 1964,
            work_x: 0,
            work_y: 48,
            work_width: 3024,
            work_height: 1880,
            scale: 2.0,
        };
        let dimensions = resolve_voice_overlay_dimensions(
            VoiceOverlayPresentationMode::Expanded,
            None,
            None,
            Some(geometry),
        );

        assert_eq!(dimensions.width, 720.0);
        assert_eq!(dimensions.height, 680.0);
        assert_eq!(dimensions.min_width, Some(560.0));
        assert_eq!(dimensions.min_height, Some(480.0));
    }

    #[test]
    fn expanded_dimensions_shrink_below_minimum_only_for_small_work_area() {
        let geometry = CursorMonitorGeometry {
            source: "test",
            cursor_x: -800.0,
            cursor_y: 100.0,
            monitor_x: -1100,
            monitor_y: 0,
            monitor_width: 1100,
            monitor_height: 900,
            work_x: -1100,
            work_y: 0,
            work_width: 1100,
            work_height: 900,
            scale: 2.0,
        };
        let dimensions = resolve_voice_overlay_dimensions(
            VoiceOverlayPresentationMode::Expanded,
            None,
            None,
            Some(geometry),
        );

        assert_eq!(dimensions.width, 502.0);
        assert_eq!(dimensions.height, 402.0);
        assert_eq!(dimensions.min_width, Some(502.0));
        assert_eq!(dimensions.min_height, Some(402.0));
    }
}
