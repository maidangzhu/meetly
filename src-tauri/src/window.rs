use tauri::{App, Manager, PhysicalPosition, Position, WebviewWindow};

const ISLAND_WIDTH: f64 = 600.0;
const COLLAPSED_HEIGHT: f64 = 54.0;
const TOP_OFFSET: i32 = 54;

#[tauri::command]
pub fn set_island_height(window: WebviewWindow, height: u32) -> Result<(), String> {
    let size = tauri::LogicalSize::new(ISLAND_WIDTH, height as f64);
    window.set_size(size).map_err(|error| error.to_string())?;
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

pub fn setup_island_window(app: &mut App) -> tauri::Result<()> {
    let Some(window) = app.get_webview_window("island") else {
        return Ok(());
    };

    #[cfg(target_os = "macos")]
    setup_macos_panel(&window);

    position_top_center(&window)?;

    Ok(())
}

fn position_top_center(window: &WebviewWindow) -> tauri::Result<()> {
    window.set_size(tauri::LogicalSize::new(
        ISLAND_WIDTH,
        COLLAPSED_HEIGHT,
    ))?;

    if let Some(monitor) = window.primary_monitor()? {
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
        let desired_y = monitor_top + TOP_OFFSET;

        let max_x = monitor_right - window_width;
        let max_y = monitor_bottom - window_height;
        let x = clamp_i32(centered_x, monitor_left, max_x.max(monitor_left));
        let y = clamp_i32(desired_y, monitor_top, max_y.max(monitor_top));

        window.set_position(Position::Physical(PhysicalPosition::new(x, y)))?;
    }

    Ok(())
}

fn clamp_i32(value: i32, min: i32, max: i32) -> i32 {
    value.max(min).min(max)
}

#[cfg(target_os = "macos")]
fn setup_macos_panel(window: &WebviewWindow) {
    use tauri_nspanel::{
        cocoa::appkit::NSWindowCollectionBehavior, panel_delegate, WebviewWindowExt,
    };

    let panel = window.to_panel().expect("failed to convert window to NSPanel");

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
