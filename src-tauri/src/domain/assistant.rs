use serde::Deserialize;

/// Which tone/prompt to use for an Ask request. Matches
/// docs/PRD.md section 5.3 / docs/TECHNICAL_DESIGN.md section 4.8, minus
/// `debug` (screen-analysis mode), which is out of scope for this change —
/// see openspec/changes/add-llm-suggestions/proposal.md non-goals.
#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AssistantMode {
    Interview,
    Meeting,
    Sales,
}
