# Design: add-llm-suggestions

## Context

The user confirmed a non-streaming design: one request, one complete
structured JSON response, rather than SSE token-by-token streaming into the
UI. Rationale discussed with the user: the required output is a fixed-shape
JSON object (`answer`/`bullets`/`clarifying_question`), and the product
requirement is that this JSON be short (one to two sentences, up to three
bullets) — parsing a half-streamed JSON object into partial UI state adds
real complexity for a response that is already fast to generate in full
because it's short. This differs from `docs/TECHNICAL_DESIGN.md`, which did
not commit to streaming vs non-streaming; this design closes that gap.

`pluely-master`'s `fetchAIResponse` (`src/lib/functions/ai-response.function.ts:164-416`)
does implement SSE parsing for arbitrary chat UIs, which is the right choice
for a general chatbot but not for Meetly's fixed-schema suggestion output.

## Goals / Non-Goals

Goals:
- Turn a transcript window into one short, structured suggestion per Ask.
- Reuse the `reqwest` client already added in `add-system-audio-transcription`.

Non-goals:
- Streaming.
- Multi-turn chat memory.

## Decisions

### Request shape

OpenAI-compatible `chat/completions`, forcing JSON output via
`response_format`:

```json
{
  "model": "Qwen/Qwen3-32B",
  "messages": [
    { "role": "system", "content": "<mode prompt + instructions to return JSON>" },
    { "role": "user", "content": "<last 90s of transcript, formatted>" }
  ],
  "response_format": { "type": "json_object" },
  "temperature": 0.3,
  "stream": false
}
```

Not every OpenAI-compatible provider supports `response_format:
json_object`. If the provider ignores it, the response is still parsed as
best-effort JSON (see Error Handling below); this is a known limitation, not
silently masked.

### Domain types

```rust
pub enum AssistantMode {
    Interview,
    Meeting,
    Sales,
}

pub struct AssistantSuggestion {
    pub answer: String,
    pub bullets: Vec<String>,       // max 3, enforced by prompt + truncation
    pub clarifying_question: Option<String>,
}
```

Matches the schema already specified in `docs/TECHNICAL_DESIGN.md` section
4.6, minus the `risk` field (dropped: not used by any current UI, and the
user did not ask for it when reviewing this change; can be added back as a
follow-up if needed).

### Prompt orchestration

```rust
pub fn build_system_prompt(mode: AssistantMode) -> String {
    let mode_instructions = match mode {
        AssistantMode::Interview => INTERVIEW_PROMPT,
        AssistantMode::Meeting => MEETING_PROMPT,
        AssistantMode::Sales => SALES_PROMPT,
    };
    format!(
        "{mode_instructions}\n\n{JSON_OUTPUT_CONTRACT}",
    )
}

const JSON_OUTPUT_CONTRACT: &str = r#"
Respond with a JSON object only, matching exactly this shape:
{"answer": string, "bullets": string[] (max 3 items), "clarifying_question": string | null}
No text outside the JSON object.
"#;
```

`build_user_message` takes the transcript segments from
`TranscriptBuffer::recent(90_000)` (added in
`add-system-audio-transcription`) and joins them into a single block of
text with relative timestamps, e.g. `[-42s] ...text...`.

### LLM provider trait

```rust
#[async_trait::async_trait]
pub trait LlmProvider: Send + Sync {
    async fn complete(&self, system_prompt: String, user_message: String)
        -> anyhow::Result<AssistantSuggestion>;
}

pub struct OpenAiCompatibleLlm {
    base_url: String,
    model: String,
    api_key: String,
    client: reqwest::Client,
}

impl LlmProvider for OpenAiCompatibleLlm {
    async fn complete(&self, system_prompt: String, user_message: String)
        -> anyhow::Result<AssistantSuggestion>
    {
        let body = serde_json::json!({
            "model": self.model,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_message},
            ],
            "response_format": {"type": "json_object"},
            "temperature": 0.3,
            "stream": false,
        });

        let resp = self.client
            .post(&self.base_url)
            .bearer_auth(&self.api_key)
            .json(&body)
            .send()
            .await?;

        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            anyhow::bail!("LLM request failed: {status} {body}");
        }

        let json: serde_json::Value = resp.json().await?;
        let content = json["choices"][0]["message"]["content"]
            .as_str()
            .ok_or_else(|| anyhow::anyhow!("LLM response missing content"))?;

        parse_suggestion(content)
    }
}

fn parse_suggestion(content: &str) -> anyhow::Result<AssistantSuggestion> {
    match serde_json::from_str::<AssistantSuggestion>(content) {
        Ok(suggestion) => Ok(truncate_bullets(suggestion)),
        Err(_) => {
            // Fallback: provider did not honor response_format=json_object.
            // Show the raw text as the answer rather than failing outright.
            Ok(AssistantSuggestion {
                answer: content.trim().to_string(),
                bullets: vec![],
                clarifying_question: None,
            })
        }
    }
}

fn truncate_bullets(mut s: AssistantSuggestion) -> AssistantSuggestion {
    s.bullets.truncate(3);
    s
}
```

### Command

```rust
#[tauri::command]
async fn ask_assistant(
    app: AppHandle,
    mode: AssistantMode,
) -> Result<(), String> {
    let transcript = transcript_buffer::recent(90_000);
    if transcript.is_empty() {
        return Err("No recent conversation to base a suggestion on.".into());
    }

    let system_prompt = build_system_prompt(mode);
    let user_message = build_user_message(&transcript);

    let provider = build_llm_provider_from_saved_config().await
        .map_err(|e| e.to_string())?;

    match provider.complete(system_prompt, user_message).await {
        Ok(suggestion) => {
            let _ = app.emit("assistant_done", suggestion);
            Ok(())
        }
        Err(error) => {
            let _ = app.emit("assistant_error", error.to_string());
            Err(error.to_string())
        }
    }
}
```

### Concurrency

Each `ask_assistant` call is independent; no shared mutable state beyond
reading the transcript buffer (already `Arc<Mutex<...>>`-guarded from
`add-system-audio-transcription`). If the user clicks Ask again before a
prior request finishes, the frontend disables the Ask button while
`isAIProcessing` is true (same pattern as `pluely-master`'s
`useSystemAudio.ts:483-551`), so only one request is in flight at a time.
The Rust side does not need its own cancellation token for this change's
scope.

## Risks / Trade-offs

- `response_format: json_object` support varies by provider. The fallback
  in `parse_suggestion` degrades gracefully to a plain-text answer rather
  than surfacing a parse error to the user, at the cost of losing the
  bullets/clarifying_question structure for that one response.
- No retry logic on transient failures in this change. `docs/TECHNICAL_DESIGN.md`
  section 6.3 calls for "generation timeout: keep transcript, allow retry" —
  in this change, "allow retry" just means the user can click Ask again; no
  automatic retry.

## Migration Plan

New capability, no migration. Depends on `add-provider-settings` (LLM config
+ API key) and `add-system-audio-transcription` (transcript buffer).

## Open Questions

None outstanding.
