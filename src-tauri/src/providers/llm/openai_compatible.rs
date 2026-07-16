use super::{AssistantSuggestion, ChatMessage, LlmCapabilities, LlmProvider, ThinkingControl};
use crate::providers::config::ProviderId;
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

    async fn complete_text_request(
        &self,
        system_prompt: String,
        user_message: String,
        temperature: f32,
        disable_reasoning: bool,
    ) -> Result<String> {
        self.complete_raw(
            system_prompt,
            vec![ChatMessage::user(user_message)],
            temperature,
            disable_reasoning,
        )
        .await
    }

    async fn complete_raw(
        &self,
        system_prompt: String,
        messages: Vec<ChatMessage>,
        temperature: f32,
        disable_reasoning: bool,
    ) -> Result<String> {
        let mut request_messages = vec![json!({
            "role": "system",
            "content": system_prompt,
        })];
        request_messages.extend(
            messages
                .into_iter()
                .map(|message| serde_json::to_value(message))
                .collect::<std::result::Result<Vec<_>, _>>()?,
        );
        let mut body = json!({
            "model": self.model,
            "messages": request_messages,
            "temperature": temperature,
            "stream": false,
        });
        if disable_reasoning && self.base_url.contains("siliconflow") {
            body["enable_thinking"] = json!(false);
        }

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

        Ok(content.trim().to_string())
    }
}

#[async_trait::async_trait]
impl LlmProvider for OpenAiCompatibleLlm {
    fn id(&self) -> ProviderId {
        ProviderId::OpenAiCompatible
    }

    fn capabilities(&self) -> LlmCapabilities {
        LlmCapabilities {
            supports_streaming: true,
            thinking_control: if self.base_url.contains("siliconflow") {
                ThinkingControl::ProviderSpecific
            } else {
                ThinkingControl::Unsupported
            },
        }
    }

    async fn complete_messages(
        &self,
        system_prompt: String,
        messages: Vec<ChatMessage>,
    ) -> Result<AssistantSuggestion> {
        let content = self
            .complete_raw(system_prompt, messages, 0.3, false)
            .await?;
        Ok(parse_suggestion(&content))
    }

    async fn complete_text(
        &self,
        system_prompt: String,
        user_message: String,
        temperature: f32,
        disable_reasoning: bool,
    ) -> Result<String> {
        self.complete_text_request(system_prompt, user_message, temperature, disable_reasoning)
            .await
    }
}

/// Parses the LLM's message content into a suggestion. Some
/// OpenAI-compatible providers ignore `response_format: json_object`; when
/// that happens, this falls back to treating the raw text as the answer
/// rather than surfacing a parse error, at the cost of losing the
/// bullets/clarifying_question structure for that one response.
pub(crate) fn parse_suggestion(content: &str) -> AssistantSuggestion {
    let normalized = strip_json_code_fence(content);
    match serde_json::from_str::<AssistantSuggestion>(normalized) {
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

fn strip_json_code_fence(content: &str) -> &str {
    let trimmed = content.trim();
    let Some(rest) = trimmed.strip_prefix("```") else {
        return trimmed;
    };

    let rest = rest
        .strip_prefix("json")
        .or_else(|| rest.strip_prefix("JSON"))
        .unwrap_or(rest)
        .trim_start();

    rest.strip_suffix("```").unwrap_or(rest).trim()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_suggestion_accepts_json_code_fence() {
        let suggestion = parse_suggestion(
            r#"```json
{"answer":"可以这样说","bullets":["一","二","三","四"],"clarifyingQuestion":null}
```"#,
        );

        assert_eq!(suggestion.answer, "可以这样说");
        assert_eq!(suggestion.bullets.len(), 3);
        assert_eq!(suggestion.clarifying_question, None);
    }
}
