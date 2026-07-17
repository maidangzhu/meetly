use crate::providers::llm::{AssistantSuggestion, ChatMessage};
use tauri::AppHandle;

pub async fn complete(
    app: &AppHandle,
    system_prompt: String,
    conversation: Vec<ChatMessage>,
) -> Result<AssistantSuggestion, String> {
    super::agent_tool_loop::complete(app, workflow(), system_prompt, conversation).await
}

pub(super) fn workflow() -> super::agent_tool_loop::AgentWorkflow {
    super::agent_tool_loop::AgentWorkflow::FnGeneral
}
