use crate::providers::llm::{AssistantSuggestion, ChatMessage};
use tauri::AppHandle;

pub async fn complete(
    app: &AppHandle,
    trace_id: String,
    system_prompt: String,
    conversation: Vec<ChatMessage>,
) -> Result<AssistantSuggestion, String> {
    super::agent_tool_loop::complete(app, workflow(), Some(trace_id), system_prompt, conversation)
        .await
}

pub(super) fn workflow() -> super::agent_tool_loop::AgentWorkflow {
    super::agent_tool_loop::AgentWorkflow::FnGeneral
}
