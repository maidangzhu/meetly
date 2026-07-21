use super::agent_tool_loop::AgentContextDocument;
use crate::providers::llm::{AssistantSuggestion, ChatMessage};
use tauri::AppHandle;

pub async fn complete(
    app: &AppHandle,
    trace_id: Option<String>,
    system_prompt: String,
    user_message: String,
    documents: Vec<AgentContextDocument>,
) -> Result<AssistantSuggestion, String> {
    super::agent_tool_loop::complete(
        app,
        workflow(),
        trace_id,
        system_prompt,
        vec![ChatMessage::user(user_message)],
        documents,
    )
    .await
}

pub(super) fn workflow() -> super::agent_tool_loop::AgentWorkflow {
    super::agent_tool_loop::AgentWorkflow::MeetingCoach
}
