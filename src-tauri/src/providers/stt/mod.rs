mod audio_normalization;
mod mimo;
mod openai_compatible;

use crate::providers::config::{DiagnosticResult, ProviderId, ProviderKind};
use crate::providers::credentials;
use crate::providers::error::ProviderResult;
use anyhow::{anyhow, Result};
use tauri::AppHandle;

pub use mimo::MimoStt;
pub use openai_compatible::OpenAiCompatibleStt;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AsrExecutionMode {
    Batch,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct AsrCapabilities {
    pub execution_mode: AsrExecutionMode,
    pub supports_language_hint: bool,
    pub requires_wav_normalization: bool,
    pub max_audio_duration_ms: Option<u64>,
}

pub struct BatchAsrRequest {
    pub audio_bytes: Vec<u8>,
    pub filename: String,
    pub mime_type: String,
}

impl BatchAsrRequest {
    pub fn new(audio_bytes: Vec<u8>, filename: &str, mime_type: &str) -> Self {
        Self {
            audio_bytes,
            filename: filename.to_string(),
            mime_type: mime_type.to_string(),
        }
    }
}

#[async_trait::async_trait]
pub trait SttProvider: Send + Sync {
    fn id(&self) -> ProviderId;
    fn capabilities(&self) -> AsrCapabilities;
    async fn transcribe(&self, request: BatchAsrRequest) -> ProviderResult<String>;
}

pub fn build_from_saved_config(app: &AppHandle) -> Result<Box<dyn SttProvider>> {
    let credentials = credentials::resolve(app, ProviderKind::Stt)?;
    let provider: Box<dyn SttProvider> = match credentials.provider_id {
        ProviderId::OpenAiCompatible => Box::new(OpenAiCompatibleStt::new(credentials)),
        ProviderId::XiaomiMimo => Box::new(MimoStt::new(credentials)),
    };
    if !provider.id().supports(ProviderKind::Stt) {
        return Err(anyhow!("Configured provider does not support ASR."));
    }
    Ok(provider)
}

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

    let request = BatchAsrRequest::new(
        audio_normalization::silence_probe_wav(),
        "probe.wav",
        "audio/wav",
    );
    match provider.transcribe(request).await {
        Ok(_) => DiagnosticResult {
            success: true,
            message: format!(
                "{} endpoint reachable and accepted the ASR test request.",
                provider.id().as_str()
            ),
        },
        Err(error) => DiagnosticResult {
            success: false,
            message: error.to_string(),
        },
    }
}
