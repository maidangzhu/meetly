use super::config::{
    provider_descriptors, DiagnosticResult, ProviderConfig, ProviderDescriptor, ProviderId,
    ProviderKind,
};
use super::credentials;
use super::stt::BatchAsrRequest;
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
    provider_id: ProviderId,
    base_url: String,
    model: String,
    api_key: String,
) -> Result<(), String> {
    if !provider_id.supports(kind) {
        return Err(format!(
            "Provider {} does not support {}.",
            provider_id.as_str(),
            kind.as_str()
        ));
    }
    storage::save_config(
        &app,
        kind,
        ProviderConfig {
            provider_id,
            base_url,
            model,
        },
    )
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
pub async fn list_provider_options(kind: ProviderKind) -> Vec<ProviderDescriptor> {
    provider_descriptors(kind)
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
    let credentials =
        credentials::resolve(&app, ProviderKind::Llm).map_err(|error| error.to_string())?;

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

    let extension = if mime_type.contains("wav") || mime_type.contains("wave") {
        "wav"
    } else if mime_type.contains("mp4") {
        "mp4"
    } else if mime_type.contains("mpeg") {
        "mp3"
    } else if mime_type.contains("ogg") {
        "ogg"
    } else {
        "webm"
    };
    let filename = format!("mic_clip.{extension}");

    #[cfg(debug_assertions)]
    let failed_audio = audio_bytes.clone();

    let capabilities = provider.capabilities();
    let _ = crate::debug_log::append(&format!(
        "[stt] provider={} wav_normalization={} language_hint={} max_duration_ms={:?}",
        provider.id().as_str(),
        capabilities.requires_wav_normalization,
        capabilities.supports_language_hint,
        capabilities.max_audio_duration_ms
    ));

    provider
        .transcribe(BatchAsrRequest::new(audio_bytes, &filename, &mime_type))
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
            #[cfg(debug_assertions)]
            let saved_audio = save_failed_audio(&failed_audio, extension)
                .map(|path| format!(" saved_audio={}", path.display()))
                .unwrap_or_else(|save_error| format!(" save_audio_error={save_error}"));
            #[cfg(not(debug_assertions))]
            let saved_audio = "";
            let _ = crate::debug_log::append(&format!(
                "[stt] transcribe_audio provider_error {message}{saved_audio}"
            ));
            message
        })
}

#[cfg(debug_assertions)]
fn save_failed_audio(audio_bytes: &[u8], extension: &str) -> Result<std::path::PathBuf, String> {
    use std::time::{SystemTime, UNIX_EPOCH};

    let home = dirs::home_dir().ok_or_else(|| "Failed to resolve home directory.".to_string())?;
    let directory = home.join(".meetly").join("debug-audio");
    std::fs::create_dir_all(&directory).map_err(|error| error.to_string())?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&directory, std::fs::Permissions::from_mode(0o700))
            .map_err(|error| error.to_string())?;
    }

    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or_default();
    let path = directory.join(format!("failed-{timestamp}.{extension}"));
    std::fs::write(&path, audio_bytes).map_err(|error| error.to_string())?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600))
            .map_err(|error| error.to_string())?;
    }

    Ok(path)
}

fn preview(text: &str) -> String {
    text.chars()
        .take(120)
        .collect::<String>()
        .replace('\n', " ")
}
