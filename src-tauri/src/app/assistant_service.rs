use super::prompt_orchestrator::{build_system_prompt, build_user_message};
use crate::audio::AudioState;
use crate::domain::assistant::AssistantMode;
use crate::providers::llm::{AssistantSuggestion, LlmProvider as _};
use futures_util::StreamExt;
use serde_json::json;
use tauri::{AppHandle, Emitter};

const ASK_CONTEXT_WINDOW_MS: u64 = 180_000;

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct AssistantError {
    message: String,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct AssistantDelta {
    text: String,
}

#[tauri::command]
pub async fn ask_assistant(
    app: AppHandle,
    audio_state: tauri::State<'_, AudioState>,
    mode: AssistantMode,
) -> Result<(), String> {
    let transcript = crate::audio::recent_transcript(&audio_state, ASK_CONTEXT_WINDOW_MS);
    if transcript.is_empty() {
        return Err("No recent conversation to base a suggestion on.".to_string());
    }

    let system_prompt = build_system_prompt(mode);
    let user_message = build_user_message(&transcript);

    run_completion(app, system_prompt, user_message).await
}

/// Same LLM call as `ask_assistant`, but the user message is a directly
/// provided question instead of pulled from the system-audio transcript
/// buffer. Used by the microphone Ask flow (record -> transcribe -> ask),
/// which mirrors pluely-master's `AudioRecorder.tsx` -> `fetchSTT` ->
/// `onTranscriptionComplete` flow but keeps the LLM call on the Rust side
/// instead of duplicating provider logic in JS.
#[tauri::command]
pub async fn ask_assistant_with_question(
    app: AppHandle,
    mode: AssistantMode,
    question: String,
) -> Result<(), String> {
    if question.trim().is_empty() {
        return Err("Question is empty.".to_string());
    }

    let system_prompt = build_system_prompt(mode);
    let _ = crate::debug_log::append(&format!(
        "[ask] ask_assistant_with_question mode={mode:?} question_chars={} question_preview={}",
        question.chars().count(),
        question
            .chars()
            .take(240)
            .collect::<String>()
            .replace('\n', " ")
    ));
    run_completion(app, system_prompt, question).await
}

/// Runs the same completion path as `ask_assistant_with_question`, but returns
/// the suggestion directly instead of emitting `assistant_done`. This is used
/// by frontend prefetch so background answers do not appear until the user
/// accepts the detected question.
#[tauri::command]
pub async fn complete_assistant_with_question(
    app: AppHandle,
    mode: AssistantMode,
    question: String,
) -> Result<AssistantSuggestion, String> {
    if question.trim().is_empty() {
        return Err("Question is empty.".to_string());
    }

    let system_prompt = build_system_prompt(mode);
    let _ = crate::debug_log::append(&format!(
        "[ask] complete_assistant_with_question mode={mode:?} question_chars={} question_preview={}",
        question.chars().count(),
        question
            .chars()
            .take(240)
            .collect::<String>()
            .replace('\n', " ")
    ));

    run_completion_return(app, system_prompt, question).await
}

async fn run_completion(
    app: AppHandle,
    system_prompt: String,
    user_message: String,
) -> Result<(), String> {
    match run_completion_streaming(app.clone(), system_prompt, user_message).await {
        Ok(suggestion) => {
            emit_done(&app, suggestion);
            Ok(())
        }
        Err(message) => {
            emit_error(&app, &message);
            Err(message)
        }
    }
}

async fn run_completion_return(
    app: AppHandle,
    system_prompt: String,
    user_message: String,
) -> Result<AssistantSuggestion, String> {
    let provider = crate::providers::llm::build_from_saved_config(&app).map_err(|error| {
        let message = error.to_string();
        message
    })?;

    provider
        .complete(system_prompt, user_message)
        .await
        .map_err(|error| error.to_string())
}

async fn run_completion_streaming(
    app: AppHandle,
    system_prompt: String,
    user_message: String,
) -> Result<AssistantSuggestion, String> {
    let credentials =
        crate::providers::credentials::resolve(&app, crate::providers::config::ProviderKind::Llm)
            .map_err(|error| error.to_string())?;

    let body = json!({
        "model": credentials.model,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_message},
        ],
        "temperature": 0.3,
        "stream": true,
    });

    let response = reqwest::Client::new()
        .post(&credentials.base_url)
        .bearer_auth(&credentials.api_key)
        .json(&body)
        .send()
        .await
        .map_err(|error| error.to_string())?;

    let status = response.status();
    if !status.is_success() {
        let error_body = response.text().await.unwrap_or_default();
        return Err(format!("LLM request failed: {status} {error_body}"));
    }

    let mut content = String::new();
    let mut pending = String::new();
    let mut stream = response.bytes_stream();

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|error| error.to_string())?;
        pending.push_str(&String::from_utf8_lossy(&chunk));

        while let Some(index) = pending.find('\n') {
            let line = pending[..index].trim().to_string();
            pending = pending[index + 1..].to_string();

            if line.is_empty() || !line.starts_with("data:") {
                continue;
            }

            let data = line.trim_start_matches("data:").trim();
            if data == "[DONE]" {
                break;
            }

            let value: serde_json::Value = match serde_json::from_str(data) {
                Ok(value) => value,
                Err(_) => continue,
            };

            let delta = value
                .get("choices")
                .and_then(|choices| choices.get(0))
                .and_then(|choice| choice.get("delta"))
                .and_then(|delta| delta.get("content"))
                .and_then(|content| content.as_str())
                .unwrap_or("");

            if delta.is_empty() {
                continue;
            }

            content.push_str(delta);
            let _ = app.emit(
                "assistant_delta",
                AssistantDelta {
                    text: delta.to_string(),
                },
            );
        }
    }

    if content.trim().is_empty() {
        return Err("LLM stream completed without content.".to_string());
    }

    Ok(crate::providers::llm::parse_suggestion(&content))
}

fn emit_done(app: &AppHandle, suggestion: AssistantSuggestion) {
    let _ = app.emit("assistant_done", suggestion);
}

fn emit_error(app: &AppHandle, message: &str) {
    let _ = app.emit(
        "assistant_error",
        AssistantError {
            message: message.to_string(),
        },
    );
}
