mod agent_tool_loop;
pub mod assistant_service;
mod coach_agent;
pub mod document_service;
pub mod prompt_orchestrator;
pub mod report_service;
mod voice_agent;

#[cfg(test)]
mod tests {
    #[test]
    fn coach_and_fn_use_distinct_agent_workflows() {
        assert_ne!(
            super::coach_agent::workflow(),
            super::voice_agent::workflow()
        );
    }
}
