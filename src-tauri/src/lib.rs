mod window;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default().plugin(tauri_plugin_opener::init());

    #[cfg(target_os = "macos")]
    let builder = builder.plugin(tauri_nspanel::init());

    builder
        .invoke_handler(tauri::generate_handler![
            window::set_island_height,
            window::set_island_visible
        ])
        .setup(|app| {
            window::setup_island_window(app)?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("failed to run Tauri application");
}
