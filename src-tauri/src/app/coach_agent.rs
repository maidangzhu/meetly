use crate::providers::llm::{AssistantSuggestion, ChatMessage};
use tauri::AppHandle;

pub async fn complete(
    app: &AppHandle,
    system_prompt: String,
    user_message: String,
) -> Result<AssistantSuggestion, String> {
    super::agent_tool_loop::complete(
        app,
        workflow(),
        system_prompt,
        vec![ChatMessage::user(user_message)],
    )
    .await
}

pub(super) fn workflow() -> super::agent_tool_loop::AgentWorkflow {
    super::agent_tool_loop::AgentWorkflow::MeetingCoach
}
