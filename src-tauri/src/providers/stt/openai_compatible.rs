use super::{AsrCapabilities, AsrExecutionMode, BatchAsrRequest, SttProvider};
use crate::providers::config::ProviderId;
use crate::providers::credentials::ResolvedCredentials;
use crate::providers::error::{ProviderFailure, ProviderResult};
use serde::Deserialize;

pub struct OpenAiCompatibleStt {
    base_url: String,
    model: String,
    api_key: String,
    client: reqwest::Client,
}

#[derive(Debug, Deserialize)]
struct SttResponse {
    text: String,
}

impl OpenAiCompatibleStt {
    pub fn new(credentials: ResolvedCredentials) -> Self {
        Self {
            base_url: credentials.base_url,
            model: credentials.model,
            api_key: credentials.api_key,
            client: reqwest::Client::new(),
        }
    }
}

#[async_trait::async_trait]
impl SttProvider for OpenAiCompatibleStt {
    fn id(&self) -> ProviderId {
        ProviderId::OpenAiCompatible
    }

    fn capabilities(&self) -> AsrCapabilities {
        AsrCapabilities {
            execution_mode: AsrExecutionMode::Batch,
            supports_language_hint: false,
            requires_wav_normalization: false,
            max_audio_duration_ms: None,
        }
    }

    async fn transcribe(&self, request: BatchAsrRequest) -> ProviderResult<String> {
        let part = reqwest::multipart::Part::bytes(request.audio_bytes)
            .file_name(request.filename)
            .mime_str(&request.mime_type)
            .map_err(|error| ProviderFailure::invalid_request(self.id(), error.to_string()))?;

        let form = reqwest::multipart::Form::new()
            .text("model", self.model.clone())
            .part("file", part);

        let response = self
            .client
            .post(&self.base_url)
            .bearer_auth(&self.api_key)
            .multipart(form)
            .send()
            .await
            .map_err(|error| ProviderFailure::transport(self.id(), error))?;

        let status = response.status();
        if !status.is_success() {
            let body = response.text().await.unwrap_or_default();
            return Err(ProviderFailure::http(self.id(), status, &body));
        }

        let parsed: SttResponse = response
            .json()
            .await
            .map_err(|error| ProviderFailure::invalid_response(self.id(), error.to_string()))?;
        Ok(parsed.text)
    }
}
