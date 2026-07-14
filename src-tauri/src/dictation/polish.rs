use crate::providers::llm;
use std::time::Duration;
use tauri::AppHandle;

const SYSTEM_PROMPT: &str = "You clean up speech-to-text dictation. Preserve the user's language, meaning, tone, names, numbers, URLs, code, product names, and domain terms. Remove meaningless filler words, false starts, and obvious repetitions. Fix punctuation, grammar, and spoken formatting. Do not answer questions, add arguments, invent facts, or expand the user's ideas. Return only the final text without explanation or Markdown fences.";

pub async fn run(app: &AppHandle, raw_text: &str) -> Result<String, String> {
    let provider = llm::build_from_saved_config(app).map_err(|error| error.to_string())?;
    let completion = tokio::time::timeout(
        Duration::from_secs(8),
        provider.complete_text(SYSTEM_PROMPT.to_string(), raw_text.to_string(), 0.2, true),
    )
    .await
    .map_err(|_| "AI polish timed out.".to_string())?
    .map_err(|error| error.to_string())?;

    let normalized = strip_code_fence(&completion).trim().to_string();
    if normalized.is_empty() {
        return Err("AI polish returned empty text.".to_string());
    }
    Ok(normalized)
}

fn strip_code_fence(value: &str) -> &str {
    let trimmed = value.trim();
    let Some(rest) = trimmed.strip_prefix("```") else {
        return trimmed;
    };
    let rest = rest
        .strip_prefix("text")
        .or_else(|| rest.strip_prefix("markdown"))
        .unwrap_or(rest)
        .trim_start();
    rest.strip_suffix("```").unwrap_or(rest).trim()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strips_common_code_fences() {
        assert_eq!(strip_code_fence("```text\nhello\n```"), "hello");
        assert_eq!(strip_code_fence("plain"), "plain");
    }
}
