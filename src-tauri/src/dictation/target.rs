#[derive(Debug, Clone)]
pub struct TargetSnapshot {
    pub pid: i32,
    pub app_name: Option<String>,
    #[cfg(target_os = "macos")]
    focused_element: Option<FocusedElementSnapshot>,
}

#[cfg(target_os = "macos")]
#[derive(Debug, Clone)]
struct FocusedElementSnapshot(accessibility::AXUIElement);

// AXUIElement is a retained Core Foundation reference. macOS Accessibility
// messaging supports using the reference from the output worker thread.
#[cfg(target_os = "macos")]
unsafe impl Send for FocusedElementSnapshot {}

#[cfg(target_os = "macos")]
unsafe impl Sync for FocusedElementSnapshot {}

#[cfg(target_os = "macos")]
pub fn capture() -> Option<TargetSnapshot> {
    let (pid, app_name) = capture_app_identity()?;
    let focused_element = capture_focused_element(pid);
    Some(TargetSnapshot {
        pid,
        app_name,
        focused_element,
    })
}

#[cfg(target_os = "macos")]
pub fn capture_app_identity() -> Option<(i32, Option<String>)> {
    use objc2_app_kit::NSWorkspace;

    let workspace = NSWorkspace::sharedWorkspace();
    let app = workspace.frontmostApplication()?;
    let pid = app.processIdentifier();
    let app_name = app.localizedName().map(|name| name.to_string());
    Some((pid, app_name))
}

#[cfg(target_os = "macos")]
fn capture_focused_element(pid: i32) -> Option<FocusedElementSnapshot> {
    use accessibility::{AXAttribute, AXUIElement};
    use core_foundation::{base::CFType, string::CFString};

    if !handy_keys::check_accessibility() {
        return None;
    }

    let application = AXUIElement::application(pid);
    application.set_messaging_timeout(0.25).ok()?;
    let attribute = AXAttribute::new(&CFString::from_static_string("AXFocusedUIElement"));
    let value: CFType = application.attribute(&attribute).ok()?;
    value.downcast::<AXUIElement>().map(FocusedElementSnapshot)
}

#[cfg(not(target_os = "macos"))]
pub fn capture() -> Option<TargetSnapshot> {
    None
}

#[cfg(not(target_os = "macos"))]
pub fn capture_app_identity() -> Option<(i32, Option<String>)> {
    None
}

#[cfg(target_os = "macos")]
pub async fn activate(app: &tauri::AppHandle, target: &TargetSnapshot) -> bool {
    let (tx, rx) = tokio::sync::oneshot::channel();
    let target = target.clone();
    if app
        .run_on_main_thread(move || {
            let _ = tx.send(activate_on_main_thread(&target));
        })
        .is_err()
    {
        return false;
    }
    rx.await.unwrap_or(false)
}

#[cfg(target_os = "macos")]
pub fn restore_focus(target: &TargetSnapshot) -> Result<(), String> {
    use accessibility::AXAttribute;
    use core_foundation::boolean::CFBoolean;

    let focused = target
        .focused_element
        .as_ref()
        .ok_or_else(|| "The original focused input is unavailable.".to_string())?;
    focused
        .0
        .set_messaging_timeout(0.25)
        .map_err(|error| error.to_string())?;
    focused
        .0
        .set_attribute(&AXAttribute::focused(), CFBoolean::true_value())
        .map_err(|error| error.to_string())
}

#[cfg(target_os = "macos")]
fn activate_on_main_thread(target: &TargetSnapshot) -> bool {
    use objc2_app_kit::{NSApplicationActivationOptions, NSRunningApplication};

    let Some(app) = NSRunningApplication::runningApplicationWithProcessIdentifier(target.pid)
    else {
        return false;
    };
    if app.isTerminated() {
        return false;
    }
    if app.isActive() {
        return true;
    }
    app.activateWithOptions(NSApplicationActivationOptions::ActivateAllWindows)
}

#[cfg(not(target_os = "macos"))]
pub async fn activate(_app: &tauri::AppHandle, _target: &TargetSnapshot) -> bool {
    false
}

#[cfg(not(target_os = "macos"))]
pub fn restore_focus(_target: &TargetSnapshot) -> Result<(), String> {
    Err("Restoring input focus is only supported on macOS.".to_string())
}
