use super::{AssistantSuggestion, LlmProvider};
use crate::providers::credentials::ResolvedCredentials;
use anyhow::{anyhow, Result};
use serde_json::json;

/// LLM adapter for any endpoint that accepts the OpenAI
/// `chat/completions` request shape. SiliconFlow, OpenAI, DeepSeek, and most
/// domestic OpenAI-compatible providers implement this shape; switching
/// providers only requires changing base_url/model/api_key in Settings.
pub struct OpenAiCompatibleLlm {
    base_url: String,
    model: String,
    api_key: String,
    client: reqwest::Client,
}

impl OpenAiCompatibleLlm {
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
impl LlmProvider for OpenAiCompatibleLlm {
    async fn complete(
        &self,
        system_prompt: String,
        user_message: String,
    ) -> Result<AssistantSuggestion> {
        let body = json!({
            "model": self.model,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_message},
            ],
            "temperature": 0.3,
            "stream": false,
        });

        let response = self
            .client
            .post(&self.base_url)
            .bearer_auth(&self.api_key)
            .json(&body)
            .send()
            .await?;

        let status = response.status();
        if !status.is_success() {
            let error_body = response.text().await.unwrap_or_default();
            return Err(anyhow!("LLM request failed: {status} {error_body}"));
        }

        let json: serde_json::Value = response.json().await?;
        let content = json
            .get("choices")
            .and_then(|choices| choices.get(0))
            .and_then(|choice| choice.get("message"))
            .and_then(|message| message.get("content"))
            .and_then(|content| content.as_str())
            .ok_or_else(|| anyhow!("LLM response missing choices[0].message.content"))?;

        Ok(parse_suggestion(content))
    }
}

/// Parses the LLM's message content into a suggestion. Some
/// OpenAI-compatible providers ignore `response_format: json_object`; when
/// that happens, this falls back to treating the raw text as the answer
/// rather than surfacing a parse error, at the cost of losing the
/// bullets/clarifying_question structure for that one response.
pub(crate) fn parse_suggestion(content: &str) -> AssistantSuggestion {
    match serde_json::from_str::<AssistantSuggestion>(content) {
        Ok(mut suggestion) => {
            suggestion.bullets.truncate(3);
            suggestion
        }
        Err(_) => AssistantSuggestion {
            answer: content.trim().to_string(),
            bullets: Vec::new(),
            clarifying_question: None,
        },
    }
}
