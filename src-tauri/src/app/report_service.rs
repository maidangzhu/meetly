use crate::providers::config::ProviderKind;
use futures_util::StreamExt;
use serde_json::json;
use std::fs;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::AppHandle;

#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InterviewReportRequest {
    session_id: String,
    started_at: u64,
    ended_at: u64,
    assistant_mode: String,
    transcript: Vec<ReportTranscriptSegment>,
    asks: Vec<ReportAskTurn>,
    coach_messages: Vec<ReportCoachMessage>,
}

#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReportTranscriptSegment {
    text: String,
    start_ms: u64,
    end_ms: u64,
    speaker: Option<String>,
}

#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReportAskTurn {
    created_at: u64,
    latest_question: String,
    context_preview: String,
    answer: Option<String>,
    error: Option<String>,
}

#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReportCoachMessage {
    created_at: u64,
    trigger: String,
    text: String,
    context_preview: String,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InterviewReportResult {
    path: String,
    markdown: String,
}

#[tauri::command]
pub async fn generate_interview_report(
    app: AppHandle,
    request: InterviewReportRequest,
) -> Result<InterviewReportResult, String> {
    let _ = crate::debug_log::append(&format!(
        "[report] start session={} transcript={} asks={} coach={}",
        request.session_id,
        request.transcript.len(),
        request.asks.len(),
        request.coach_messages.len()
    ));

    let review = generate_review(&app, &request)
        .await
        .unwrap_or_else(|error| format!("复盘生成失败：{error}"));
    let markdown = build_markdown(&request, &review);
    let path = write_report(&request.session_id, &markdown)?;

    let _ = crate::debug_log::append(&format!(
        "[report] saved session={} path={}",
        request.session_id,
        path.display()
    ));

    Ok(InterviewReportResult {
        path: path.to_string_lossy().to_string(),
        markdown,
    })
}

async fn generate_review(app: &AppHandle, request: &InterviewReportRequest) -> Result<String, String> {
    let credentials = crate::providers::credentials::resolve(app, ProviderKind::Llm)
        .map_err(|error| error.to_string())?;
    let prompt = build_review_prompt(request);
    let body = json!({
        "model": credentials.model,
        "messages": [
            {
                "role": "system",
                "content": "你是一个严厉但具体的面试复盘教练。你要基于真实转写、AI 建议和旁观者提示，输出中文 Markdown 复盘。重点说事实，不要空泛鼓励。"
            },
            {"role": "user", "content": prompt},
        ],
        "temperature": 0.25,
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
        return Err(format!("LLM report request failed: {status} {error_body}"));
    }

    collect_openai_stream_text(response).await
}

async fn collect_openai_stream_text(response: reqwest::Response) -> Result<String, String> {
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
            content.push_str(delta);
        }
    }

    if content.trim().is_empty() {
        return Err("LLM report stream completed without content.".to_string());
    }
    Ok(content)
}

fn build_review_prompt(request: &InterviewReportRequest) -> String {
    [
        "请复盘这场实时面试/对话。",
        "输出结构：",
        "1. 总体判断",
        "2. 表现好的地方",
        "3. 可以改进的地方",
        "4. 需要加强的能力点",
        "5. 下次可直接使用的回答策略",
        "6. 关键问题逐条点评",
        "",
        "要求：具体、直接、可执行。不要编造转写里没有的事实。",
        "",
        &format!("Session: {}", request.session_id),
        &format!("Mode: {}", request.assistant_mode),
        "",
        "## 转写",
        &format_transcript(&request.transcript),
        "",
        "## 每次建议",
        &format_asks(&request.asks),
        "",
        "## PI 旁观者提示",
        &format_coach_messages(&request.coach_messages),
    ]
    .join("\n")
}

fn build_markdown(request: &InterviewReportRequest, review: &str) -> String {
    [
        &format!("# Interview Report - {}", request.session_id),
        "",
        &format!("- Session ID: `{}`", request.session_id),
        &format!("- Mode: `{}`", request.assistant_mode),
        &format!("- Started At: `{}`", request.started_at),
        &format!("- Ended At: `{}`", request.ended_at),
        &format!("- Transcript Segments: `{}`", request.transcript.len()),
        &format!("- Ask Turns: `{}`", request.asks.len()),
        &format!("- PI Observer Messages: `{}`", request.coach_messages.len()),
        "",
        "## 复盘",
        "",
        review.trim(),
        "",
        "## 面试对话内容",
        "",
        &format_transcript(&request.transcript),
        "",
        "## PI 旁观者建议",
        "",
        &format_coach_messages(&request.coach_messages),
        "",
        "## 每次 Enter 建议",
        "",
        &format_asks(&request.asks),
        "",
    ]
    .join("\n")
}

fn format_transcript(transcript: &[ReportTranscriptSegment]) -> String {
    if transcript.is_empty() {
        return "_没有转写内容。_".to_string();
    }

    transcript
        .iter()
        .map(|segment| {
            let speaker = segment.speaker.as_deref().unwrap_or("unknown");
            format!(
                "- `[{}s-{}s]` **{}**: {}",
                segment.start_ms / 1000,
                segment.end_ms / 1000,
                speaker,
                segment.text
            )
        })
        .collect::<Vec<_>>()
        .join("\n")
}

fn format_asks(asks: &[ReportAskTurn]) -> String {
    if asks.is_empty() {
        return "_没有手动请求建议。_".to_string();
    }

    asks.iter()
        .enumerate()
        .map(|(index, ask)| {
            let answer = ask.answer.as_deref().unwrap_or("_没有生成成功_");
            let error = ask
                .error
                .as_ref()
                .map(|error| format!("\n  - Error: {}", error))
                .unwrap_or_default();
            format!(
                "### Ask {}\n\n- Created At: `{}`\n- Latest Question: {}\n- Context Preview: {}\n{}\n{}",
                index + 1,
                ask.created_at,
                ask.latest_question,
                ask.context_preview,
                error,
                answer
            )
        })
        .collect::<Vec<_>>()
        .join("\n\n")
}

fn format_coach_messages(messages: &[ReportCoachMessage]) -> String {
    if messages.is_empty() {
        return "_没有 PI 旁观者提示。_".to_string();
    }

    messages
        .iter()
        .map(|message| {
            format!(
                "- `{}` **{}**: {}\n  - Context: {}",
                message.created_at, message.trigger, message.text, message.context_preview
            )
        })
        .collect::<Vec<_>>()
        .join("\n")
}

fn write_report(session_id: &str, markdown: &str) -> Result<PathBuf, String> {
    let mut dir = dirs::home_dir().ok_or_else(|| "Cannot locate home directory".to_string())?;
    dir.push(".meetly");
    dir.push("reports");
    fs::create_dir_all(&dir).map_err(|error| error.to_string())?;

    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| error.to_string())?
        .as_secs();
    let filename = format!("{}-{}.md", timestamp, sanitize_filename(session_id));
    let path = dir.join(filename);
    fs::write(&path, markdown).map_err(|error| error.to_string())?;
    Ok(path)
}

fn sanitize_filename(value: &str) -> String {
    value
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' {
                ch
            } else {
                '-'
            }
        })
        .collect()
}
