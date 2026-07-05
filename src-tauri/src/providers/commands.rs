use super::config::{DiagnosticResult, ProviderConfig, ProviderKind};
use super::credentials;
use super::stt::SttProvider as _;
use super::{secrets, storage};
use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use tauri::AppHandle;

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LlmRuntimeConfig {
    pub base_url: String,
    pub model: String,
    pub api_key: String,
}

#[tauri::command]
pub async fn save_provider_config(
    app: AppHandle,
    kind: ProviderKind,
    base_url: String,
    model: String,
    api_key: String,
) -> Result<(), String> {
    storage::save_config(&app, kind, ProviderConfig { base_url, model })
        .map_err(|error| error.to_string())?;

    // Only write the Keychain entry if the caller actually provided a new
    // key. An empty string means "keep the existing key" (the Settings form
    // never pre-fills the real key, so resubmitting the base_url/model
    // without retyping the key must not wipe it).
    if !api_key.trim().is_empty() {
        secrets::set_api_key(kind, &api_key).map_err(|error| error.to_string())?;
    }

    Ok(())
}

#[tauri::command]
pub async fn get_provider_config(
    app: AppHandle,
    kind: ProviderKind,
) -> Result<ProviderConfig, String> {
    storage::get_config(&app, kind).map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn has_api_key(kind: ProviderKind) -> Result<bool, String> {
    secrets::has_api_key(kind).map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn test_stt_config(app: AppHandle) -> Result<DiagnosticResult, String> {
    Ok(crate::providers::stt::test_connection(&app).await)
}

#[tauri::command]
pub async fn test_llm_config(app: AppHandle) -> Result<DiagnosticResult, String> {
    Ok(crate::providers::llm::test_connection(&app).await)
}

/// Development runtime config for the TS PI observer.
///
/// PI is an npm runtime, so the observer needs the same model coordinates as
/// the Rust assistant provider. This command deliberately contains no agent
/// behavior; it only bridges saved local dev config into the WebView runtime.
#[tauri::command]
pub async fn get_llm_runtime_config_for_pi(app: AppHandle) -> Result<LlmRuntimeConfig, String> {
    let credentials = credentials::resolve(&app, ProviderKind::Llm)
        .map_err(|error| error.to_string())?;

    Ok(LlmRuntimeConfig {
        base_url: credentials.base_url,
        model: credentials.model,
        api_key: credentials.api_key,
    })
}

/// Transcribes a browser-recorded microphone clip. `audio_base64` is a data
/// URL or bare base64 payload from the frontend's `MediaRecorder` (webm/ogg,
/// see `src/hooks/useMicAsk.ts`). This is separate from the system-audio VAD
/// pipeline in `audio::spawn_transcription` — same `SttProvider` adapter,
/// different capture source (mic vs system output tap). `mime_type` is
/// whatever `MediaRecorder.mimeType` reported (audio/webm or audio/ogg).
#[tauri::command]
pub async fn transcribe_audio(
    app: AppHandle,
    audio_base64: String,
    mime_type: String,
) -> Result<String, String> {
    let _ = crate::debug_log::append(&format!(
        "[stt] transcribe_audio start mime_type={mime_type} payload_chars={}",
        audio_base64.len()
    ));

    let stripped = audio_base64
        .split_once(',')
        .map(|(_, data)| data)
        .unwrap_or(&audio_base64);

    let audio_bytes = BASE64.decode(stripped).map_err(|error| {
        let message = format!("Failed to decode audio: {error}");
        let _ = crate::debug_log::append(&format!("[stt] transcribe_audio decode_error {message}"));
        message
    })?;

    let _ = crate::debug_log::append(&format!(
        "[stt] transcribe_audio decoded bytes={}",
        audio_bytes.len()
    ));

    let provider = crate::providers::stt::build_from_saved_config(&app).map_err(|error| {
        let message = error.to_string();
        let _ = crate::debug_log::append(&format!("[stt] transcribe_audio config_error {message}"));
        message
    })?;

    let extension = if mime_type.contains("ogg") {
        "ogg"
    } else {
        "webm"
    };
    let filename = format!("mic_clip.{extension}");

    provider
        .transcribe(audio_bytes, &filename, &mime_type)
        .await
        .map(|text| {
            let _ = crate::debug_log::append(&format!(
                "[stt] transcribe_audio ok text_chars={} text_preview={}",
                text.chars().count(),
                preview(&text)
            ));
            text
        })
        .map_err(|error| {
            let message = error.to_string();
            let _ = crate::debug_log::append(&format!(
                "[stt] transcribe_audio provider_error {message}"
            ));
            message
        })
}

fn preview(text: &str) -> String {
    text.chars()
        .take(120)
        .collect::<String>()
        .replace('\n', " ")
}
