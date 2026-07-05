mod openai_compatible;

use crate::providers::config::DiagnosticResult;
use crate::providers::credentials;
use anyhow::Result;
use tauri::AppHandle;

pub use openai_compatible::OpenAiCompatibleStt;

/// Adapter interface for a speech-to-text provider. Implementations take a
/// complete audio clip and return the transcribed text in one call; there
/// is no streaming/partial variant (see
/// openspec/changes/add-system-audio-transcription/design.md for why).
/// `filename`/`mime_type` are passed through to the multipart upload as-is
/// so the same adapter serves both the WAV segments produced by system
/// audio VAD and arbitrary browser-recorded clips (webm/ogg) from the
/// microphone Ask flow.
#[async_trait::async_trait]
pub trait SttProvider: Send + Sync {
    async fn transcribe(
        &self,
        audio_bytes: Vec<u8>,
        filename: &str,
        mime_type: &str,
    ) -> Result<String>;
}

/// Builds an `SttProvider` from the currently saved config and Keychain API
/// key. Returns an error if no key has been saved yet.
pub fn build_from_saved_config(app: &AppHandle) -> Result<OpenAiCompatibleStt> {
    let credentials = credentials::resolve(app, crate::providers::config::ProviderKind::Stt)?;
    Ok(OpenAiCompatibleStt::new(credentials))
}

/// Sends a tiny known-silence WAV sample to the configured STT endpoint and
/// reports whether it was accepted. Used by the Settings page "Test
/// connection" button; does not require a real recording.
pub async fn test_connection(app: &AppHandle) -> DiagnosticResult {
    let provider = match build_from_saved_config(app) {
        Ok(provider) => provider,
        Err(error) => {
            return DiagnosticResult {
                success: false,
                message: error.to_string(),
            }
        }
    };

    let silence_wav = openai_compatible::silence_probe_wav();

    match provider
        .transcribe(silence_wav, "probe.wav", "audio/wav")
        .await
    {
        Ok(_) => DiagnosticResult {
            success: true,
            message: "STT endpoint reachable and accepted the test request.".to_string(),
        },
        Err(error) => DiagnosticResult {
            success: false,
            message: error.to_string(),
        },
    }
}
