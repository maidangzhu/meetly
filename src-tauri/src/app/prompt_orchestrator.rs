//! Builds the system prompt and user message for an Ask request. Tone per
//! mode follows docs/PRD.md section 5.3; output shape follows
//! docs/TECHNICAL_DESIGN.md section 4.6 (minus the `risk` field, dropped —
//! see openspec/changes/add-llm-suggestions/design.md).

use crate::audio::TranscriptSegmentDto;
use crate::domain::assistant::AssistantMode;

const INTERVIEW_PROMPT: &str = "\
You are helping a job candidate answer an interviewer's question in real \
time, during a live interview. Speak in the candidate's voice: steady, \
structured, first person. Do not coach the user in third person (\"you \
could say...\") — write the actual words the candidate should say.";

const MEETING_PROMPT: &str = "\
You are helping a meeting participant respond to what was just discussed. \
Summarize the key point being made and propose a clear next step the user \
can say out loud.";

const SALES_PROMPT: &str = "\
You are helping a salesperson respond to a prospect's objection or \
question during a live call. Address the objection directly and suggest a \
follow-up question that uncovers the prospect's real need.";

const JSON_OUTPUT_CONTRACT: &str = "\
Respond with a JSON object only, matching exactly this shape: \
{\"answer\": string, \"bullets\": string[] (max 3 items), \
\"clarifyingQuestion\": string or null}. \
The answer must be short: one or two sentences the user can say directly. \
No text outside the JSON object.";

pub fn build_system_prompt(mode: AssistantMode) -> String {
    let mode_instructions = match mode {
        AssistantMode::Interview => INTERVIEW_PROMPT,
        AssistantMode::Meeting => MEETING_PROMPT,
        AssistantMode::Sales => SALES_PROMPT,
    };

    format!("{mode_instructions}\n\n{JSON_OUTPUT_CONTRACT}")
}

/// Joins recent transcript segments into a single block of text with
/// relative timestamps (seconds before the most recent segment), for use
/// as the user message in the chat completion request.
pub fn build_user_message(segments: &[TranscriptSegmentDto]) -> String {
    let Some(newest_end_ms) = segments.last().map(|segment| segment.end_ms) else {
        return String::new();
    };

    let transcript = segments
        .iter()
        .map(|segment| {
            let seconds_ago = newest_end_ms.saturating_sub(segment.end_ms) / 1000;
            format!("[-{seconds_ago}s] {}", segment.text)
        })
        .collect::<Vec<_>>()
        .join("\n");

    format!(
        "The user is in a live meeting. The app has been continuously \
transcribing the recent conversation below. Infer what the user should say \
now, using only this meeting context.\n\nRecent transcript:\n{transcript}"
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn segment(text: &str, end_ms: u64) -> TranscriptSegmentDto {
        TranscriptSegmentDto {
            id: "test".to_string(),
            text: text.to_string(),
            start_ms: end_ms.saturating_sub(1000),
            end_ms,
        }
    }

    #[test]
    fn build_user_message_formats_relative_timestamps() {
        let segments = vec![segment("hello", 1_000), segment("world", 5_000)];
        let message = build_user_message(&segments);
        assert_eq!(
            message,
            "The user is in a live meeting. The app has been continuously \
transcribing the recent conversation below. Infer what the user should say \
now, using only this meeting context.\n\nRecent transcript:\n[-4s] hello\n[-0s] world"
        );
    }

    #[test]
    fn build_user_message_empty_input_returns_empty_string() {
        assert_eq!(build_user_message(&[]), "");
    }

    #[test]
    fn every_mode_prompt_mentions_json_contract() {
        for mode in [
            AssistantMode::Interview,
            AssistantMode::Meeting,
            AssistantMode::Sales,
        ] {
            let prompt = build_system_prompt(mode);
            assert!(prompt.contains("JSON object"));
        }
    }
}
