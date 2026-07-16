use super::audio_normalization::normalize_to_wav_16k_mono;
use super::{AsrCapabilities, AsrExecutionMode, BatchAsrRequest, SttProvider};
use crate::providers::config::ProviderId;
use crate::providers::credentials::ResolvedCredentials;
use crate::providers::error::{ProviderFailure, ProviderResult};
use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use serde_json::{json, Value};

const MAX_BASE64_DATA_URL_BYTES: usize = 10_000_000;

pub struct MimoStt {
    base_url: String,
    model: String,
    api_key: String,
    client: reqwest::Client,
}

impl MimoStt {
    pub fn new(credentials: ResolvedCredentials) -> Self {
        Self {
            base_url: credentials.base_url,
            model: credentials.model,
            api_key: credentials.api_key,
            client: reqwest::Client::new(),
        }
    }

    fn request_body(&self, audio_data_url: String) -> Value {
        json!({
            "model": self.model,
            "messages": [{
                "role": "user",
                "content": [{
                    "type": "input_audio",
                    "input_audio": {
                        "data": audio_data_url
                    }
                }]
            }],
            "asr_options": {
                "language": "auto"
            },
            "stream": false
        })
    }
}

#[async_trait::async_trait]
impl SttProvider for MimoStt {
    fn id(&self) -> ProviderId {
        ProviderId::XiaomiMimo
    }

    fn capabilities(&self) -> AsrCapabilities {
        AsrCapabilities {
            execution_mode: AsrExecutionMode::Batch,
            supports_language_hint: true,
            requires_wav_normalization: true,
            max_audio_duration_ms: Some(180_000),
        }
    }

    async fn transcribe(&self, request: BatchAsrRequest) -> ProviderResult<String> {
        let wav = normalize_to_wav_16k_mono(request)
            .map_err(|error| ProviderFailure::invalid_request(self.id(), error.to_string()))?;
        let audio_data_url = format!("data:audio/wav;base64,{}", BASE64.encode(wav));
        if audio_data_url.len() > MAX_BASE64_DATA_URL_BYTES {
            return Err(ProviderFailure::invalid_request(
                self.id(),
                "Normalized audio exceeds MiMo's 10 MB Base64 limit.",
            ));
        }

        let response = self
            .client
            .post(&self.base_url)
            .header("api-key", &self.api_key)
            .json(&self.request_body(audio_data_url))
            .send()
            .await
            .map_err(|error| ProviderFailure::transport(self.id(), error))?;

        let status = response.status();
        if !status.is_success() {
            let body = response.text().await.unwrap_or_default();
            return Err(ProviderFailure::http(self.id(), status, &body));
        }

        let body: Value = response
            .json()
            .await
            .map_err(|error| ProviderFailure::invalid_response(self.id(), error.to_string()))?;
        parse_transcript(&body)
            .map(str::to_string)
            .map_err(|message| ProviderFailure::invalid_response(self.id(), message))
    }
}

fn parse_transcript(body: &Value) -> Result<&str, &'static str> {
    body.get("choices")
        .and_then(|choices| choices.get(0))
        .and_then(|choice| choice.get("message"))
        .and_then(|message| message.get("content"))
        .and_then(Value::as_str)
        .map(str::trim)
        .ok_or("MiMo response missing choices[0].message.content")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builds_mimo_chat_completions_audio_body() {
        let provider = MimoStt::new(ResolvedCredentials {
            provider_id: ProviderId::XiaomiMimo,
            base_url: "https://api.xiaomimimo.com/v1/chat/completions".to_string(),
            model: "mimo-v2.5-asr".to_string(),
            api_key: "secret".to_string(),
        });
        let body = provider.request_body("data:audio/wav;base64,AAAA".to_string());
        assert_eq!(body["model"], "mimo-v2.5-asr");
        assert_eq!(body["messages"][0]["content"][0]["type"], "input_audio");
        assert_eq!(body["asr_options"]["language"], "auto");
    }

    #[test]
    fn parses_mimo_transcript() {
        let body = json!({"choices": [{"message": {"content": " 你好世界 "}}]});
        assert_eq!(parse_transcript(&body), Ok("你好世界"));
    }

    #[tokio::test]
    #[ignore = "requires MIMO_API_KEY and network access"]
    async fn live_mimo_silence_probe() {
        let provider = MimoStt::new(ResolvedCredentials {
            provider_id: ProviderId::XiaomiMimo,
            base_url: "https://api.xiaomimimo.com/v1/chat/completions".to_string(),
            model: "mimo-v2.5-asr".to_string(),
            api_key: std::env::var("MIMO_API_KEY").expect("MIMO_API_KEY is required"),
        });
        let request = BatchAsrRequest::new(
            super::super::audio_normalization::silence_probe_wav(),
            "probe.wav",
            "audio/wav",
        );
        provider.transcribe(request).await.unwrap();
    }
}
