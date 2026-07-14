mod app;
mod app_state;
mod audio;
mod debug_log;
mod dictation;
mod domain;
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
        .manage(dictation::DictationState::default())
        .manage(window::DictationOverlayState::default())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build());

    #[cfg(target_os = "macos")]
    let builder = builder.plugin(tauri_nspanel::init());

    builder
        .invoke_handler(tauri::generate_handler![
            window::set_island_height,
            window::set_island_visible,
            window::set_dictation_overlay_mode,
            window::set_stealth,
            window::open_settings_window,
            app_state::get_onboarding_status,
            app_state::complete_onboarding,
            app_state::open_external_url,
            app_state::quit_app,
            audio::get_audio_status,
            audio::get_recent_transcript,
            audio::start_listening,
            audio::stop_listening,
            debug_log::append_debug_log,
            dictation::cancel_dictation_run,
            dictation::finish_dictation_run,
            dictation::get_dictation_status,
            dictation::get_dictation_settings,
            dictation::paste_dictation_text,
            dictation::polish_dictation,
            dictation::request_dictation_accessibility,
            dictation::save_dictation_settings,
            dictation::test_dictation_paste,
            providers::commands::save_provider_config,
            providers::commands::get_provider_config,
            providers::commands::has_api_key,
            providers::commands::test_stt_config,
            providers::commands::test_llm_config,
            providers::commands::transcribe_audio,
            providers::commands::get_llm_runtime_config_for_pi,
            providers::web::web_fetch,
            app::document_service::extract_pdf_text,
            app::assistant_service::ask_assistant,
            app::assistant_service::ask_assistant_with_question,
            app::assistant_service::complete_assistant_with_question,
            app::report_service::generate_interview_report,
        ])
        .setup(|app| {
            window::setup_island_window(app)?;
            providers::dev_env::seed_from_dotenv_if_missing(app.handle());
            dictation::initialize(app.handle());
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("failed to run Tauri application");
}
