# Tasks: add-llm-suggestions

- [x] Add `src-tauri/src/domain/assistant.rs`: `AssistantMode`, `AssistantSuggestion`. (`AssistantSuggestion` ended up living in `providers/llm/mod.rs` alongside the `LlmProvider` trait it's the return type of; `AssistantMode` is in `domain/assistant.rs` as planned.)
- [x] Add `src-tauri/src/app/prompt_orchestrator.rs`: `build_system_prompt`, `build_user_message`, mode-specific prompt constants (`interview`/`meeting`/`sales`, per `docs/PRD.md` section 5.3 tone).
- [x] Add `src-tauri/src/providers/llm/mod.rs`: `LlmProvider` trait.
- [x] Add `src-tauri/src/providers/llm/openai_compatible.rs`: non-streaming chat completion call, `parse_suggestion` with graceful fallback for non-JSON responses.
- [x] Add `ask_assistant(mode)` command in `src-tauri/src/app/assistant_service.rs`.
- [x] Register `ask_assistant` in `src-tauri/src/lib.rs`.
- [x] Emit `assistant_done` / `assistant_error` events.
- [x] Update `src/App.tsx` Ask button and assistant panel to call `ask_assistant`, listen for `assistant_done`/`assistant_error`, render `answer`/`bullets`/`clarifyingQuestion`, and disable the Ask button while a request is in flight. (Added a dedicated always-visible Ask icon button plus an interview/meeting/sales mode switcher in the expanded panel.)
- [x] Handle "no recent transcript" case: `ask_assistant` returns an error before sending any request; frontend surfaces it via `assistantError`.
- [x] Handle "no LLM provider configured" case: same treatment as the STT "not configured" case in `add-system-audio-transcription` (both go through `providers::credentials::resolve`, which errors before any HTTP call).
- [x] Run frontend build.
- [x] Run Rust check.
- [x] Added unit tests for `prompt_orchestrator` (relative-timestamp formatting, empty-input, every mode mentions the JSON contract) — all passing (`cargo test --lib`, 11/11 total).
- [ ] Manual test: speak a question into system audio, wait for a `transcript_final`, click Ask, confirm a structured suggestion renders. (Not run — requires a configured LLM API key and live audio.)
- [ ] Manual test: click Ask with no recent transcript, confirm the clear "nothing to work with yet" message instead of a raw error. (Not run — requires clicking through the running app.)
