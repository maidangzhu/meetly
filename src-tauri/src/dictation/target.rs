#[derive(Debug, Clone)]
pub struct TargetSnapshot {
    pub pid: i32,
    pub app_name: Option<String>,
}

#[cfg(target_os = "macos")]
pub fn capture() -> Option<TargetSnapshot> {
    use objc2_app_kit::NSWorkspace;

    let workspace = NSWorkspace::sharedWorkspace();
    let app = workspace.frontmostApplication()?;
    let pid = app.processIdentifier();
    let app_name = app.localizedName().map(|name| name.to_string());
    Some(TargetSnapshot { pid, app_name })
}

#[cfg(not(target_os = "macos"))]
pub fn capture() -> Option<TargetSnapshot> {
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
