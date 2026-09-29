mod app;
mod app_state;
mod audio;
mod debug_log;
mod menu_bar;
mod providers;
mod window;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info,meetly_lib=debug")),
        )
        .init();

    let builder = tauri::Builder::default()
        .manage(audio::AudioState::default())
        .manage(window::IslandWindowState::default())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build());

    #[cfg(target_os = "macos")]
    let builder = builder.plugin(tauri_nspanel::init());

    let app = builder
        .invoke_handler(tauri::generate_handler![
            window::set_island_height,
            window::set_island_meeting_active,
            window::set_island_visible,
            window::set_stealth,
            window::open_settings_window,
            app_state::get_onboarding_status,
            app_state::complete_onboarding,
            app_state::get_listening_profile,
            app_state::save_listening_profile,
            app_state::open_external_url,
            app_state::quit_app,
            audio::get_audio_status,
            audio::get_recent_transcript,
            audio::start_listening,
            audio::start_meeting_capture,
            audio::stop_listening,
            audio::stop_meeting_capture,
            debug_log::append_debug_log,
            providers::commands::save_provider_config,
            providers::commands::get_provider_config,
            providers::commands::list_provider_options,
            providers::commands::has_api_key,
            providers::commands::test_stt_config,
            providers::commands::test_llm_config,
            providers::commands::transcribe_audio,
            app::term_service::explain_transcript_terms,
        ])
        .setup(|app| {
            let _ = debug_log::append(&format!(
                "[native] app start version={} debug_assertions={}",
                app.package_info().version,
                cfg!(debug_assertions)
            ));
            menu_bar::setup(app)?;
            window::setup_island_window(app)?;
            providers::dev_env::seed_from_dotenv_if_missing(app.handle());
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("failed to build Tauri application");

    app.run(|_app, _event| {
        #[cfg(target_os = "macos")]
        if let tauri::RunEvent::Reopen {
            has_visible_windows,
            ..
        } = _event
        {
            let _ = debug_log::append(&format!(
                "[lifecycle] dock reopen has_visible_windows={has_visible_windows}"
            ));
            if let Err(error) = window::reopen_island_window(_app) {
                let _ = debug_log::append(&format!("[lifecycle] dock reopen failed error={error}"));
            }
        }
    });
}
