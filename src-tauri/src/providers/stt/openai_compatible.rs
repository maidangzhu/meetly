use super::SttProvider;
use crate::providers::credentials::ResolvedCredentials;
use anyhow::{anyhow, Result};
use serde::Deserialize;

/// STT adapter for any endpoint that accepts the OpenAI Whisper
/// `multipart/form-data` request shape (`file`, `model`) and returns
/// `{"text": "..."}`. SiliconFlow, OpenAI, and Groq all implement this
/// shape; switching providers only requires changing base_url/model/api_key
/// in Settings, not this code.
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
    async fn transcribe(
        &self,
        audio_bytes: Vec<u8>,
        filename: &str,
        mime_type: &str,
    ) -> Result<String> {
        let part = reqwest::multipart::Part::bytes(audio_bytes)
            .file_name(filename.to_string())
            .mime_str(mime_type)?;

        let form = reqwest::multipart::Form::new()
            .text("model", self.model.clone())
            .part("file", part);

        let response = self
            .client
            .post(&self.base_url)
            .bearer_auth(&self.api_key)
            .multipart(form)
            .send()
            .await?;

        let status = response.status();
        if !status.is_success() {
            let body = response.text().await.unwrap_or_default();
            return Err(anyhow!("STT request failed: {status} {body}"));
        }

        let parsed: SttResponse = response
            .json()
            .await
            .map_err(|error| anyhow!("STT response was not the expected JSON shape: {error}"))?;

        Ok(parsed.text)
    }
}

/// A ~200ms silent 16kHz mono WAV, used only to probe connectivity/auth
/// without requiring the user to have already recorded anything.
pub fn silence_probe_wav() -> Vec<u8> {
    const SAMPLE_RATE: u32 = 16_000;
    const SAMPLE_COUNT: usize = (SAMPLE_RATE as usize) / 5; // 200ms

    let spec = hound::WavSpec {
        channels: 1,
        sample_rate: SAMPLE_RATE,
        bits_per_sample: 16,
        sample_format: hound::SampleFormat::Int,
    };

    let mut cursor = std::io::Cursor::new(Vec::new());
    {
        let mut writer = hound::WavWriter::new(&mut cursor, spec)
            .expect("failed to create in-memory WAV writer for silence probe");
        for _ in 0..SAMPLE_COUNT {
            writer
                .write_sample(0i16)
                .expect("failed to write silence sample");
        }
        writer
            .finalize()
            .expect("failed to finalize silence probe WAV");
    }

    cursor.into_inner()
}
