mod openai_compatible;

use crate::providers::config::{DiagnosticResult, ProviderId, ProviderKind};
use crate::providers::credentials;
use anyhow::{anyhow, Result};
use serde::{Deserialize, Serialize};
use tauri::AppHandle;

pub(crate) use openai_compatible::parse_suggestion;
pub use openai_compatible::OpenAiCompatibleLlm;

/// Structured suggestion returned by the assistant. Matches the schema in
/// docs/TECHNICAL_DESIGN.md section 4.6, minus the `risk` field (dropped;
/// see openspec/changes/add-llm-suggestions/design.md). `camelCase` on the
/// wire in both directions: it's what the LLM is instructed to return (see
/// `prompt_orchestrator::JSON_OUTPUT_CONTRACT`) and what gets emitted to the
/// frontend as the `assistant_done` event payload, matching every other
/// Tauri DTO in this project.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AssistantSuggestion {
    pub answer: String,
    #[serde(default)]
    pub bullets: Vec<String>,
    #[serde(default)]
    pub clarifying_question: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ChatRole {
    User,
    Assistant,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatMessage {
    pub role: ChatRole,
    pub content: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ThinkingControl {
    Unsupported,
    ProviderSpecific,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct LlmCapabilities {
    pub supports_streaming: bool,
    pub thinking_control: ThinkingControl,
}

impl ChatMessage {
    pub fn user(content: impl Into<String>) -> Self {
        Self {
            role: ChatRole::User,
            content: content.into(),
        }
    }

    pub fn assistant(content: impl Into<String>) -> Self {
        Self {
            role: ChatRole::Assistant,
            content: content.into(),
        }
    }
}

/// Adapter interface for an LLM provider. One non-streaming call in, one
/// complete structured suggestion out (see
/// openspec/changes/add-llm-suggestions/design.md for why this is
/// non-streaming).
#[async_trait::async_trait]
pub trait LlmProvider: Send + Sync {
    fn id(&self) -> ProviderId;
    fn capabilities(&self) -> LlmCapabilities;

    async fn complete_messages(
        &self,
        system_prompt: String,
        messages: Vec<ChatMessage>,
    ) -> Result<AssistantSuggestion>;

    async fn complete_text(
        &self,
        system_prompt: String,
        user_message: String,
        temperature: f32,
        disable_reasoning: bool,
    ) -> Result<String>;

    async fn complete(
        &self,
        system_prompt: String,
        user_message: String,
    ) -> Result<AssistantSuggestion> {
        self.complete_messages(system_prompt, vec![ChatMessage::user(user_message)])
            .await
    }
}

/// Builds an `LlmProvider` from the currently saved config and Keychain API
/// key. Returns an error if no key has been saved yet.
pub fn build_from_saved_config(app: &AppHandle) -> Result<Box<dyn LlmProvider>> {
    let credentials = credentials::resolve(app, ProviderKind::Llm)?;
    match credentials.provider_id {
        ProviderId::OpenAiCompatible => Ok(Box::new(OpenAiCompatibleLlm::new(credentials))),
        provider_id => Err(anyhow!(
            "Provider {} is not registered for LLM.",
            provider_id.as_str()
        )),
    }
}

/// Sends a minimal chat completion request ("respond with OK") to the
/// configured LLM endpoint and reports whether it succeeded. Used by the
/// Settings page "Test connection" button.
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

    let probe_prompt =
        "Respond with a JSON object exactly like {\"answer\": \"OK\", \"bullets\": [], \"clarifyingQuestion\": null} and nothing else.";

    match provider
        .complete(probe_prompt.to_string(), "ping".to_string())
        .await
    {
        Ok(_) => {
            let capabilities = provider.capabilities();
            DiagnosticResult {
                success: true,
                message: format!(
                    "{} LLM endpoint reachable (streaming={}, thinking={:?}).",
                    provider.id().as_str(),
                    capabilities.supports_streaming,
                    capabilities.thinking_control
                ),
            }
        }
        Err(error) => DiagnosticResult {
            success: false,
            message: error.to_string(),
        },
    }
}
