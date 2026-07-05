# Proposal: add-llm-suggestions

## Why

Once `add-system-audio-transcription` produces real transcript segments,
Meetly needs to turn "what was just said" into a short, sayable suggestion
when the user asks for one. This is the other half of the MVP's core loop
described in `docs/PRD.md` section 3.1.

## What

- Add an `ask_assistant(mode)` Rust command that:
  - Pulls the last 90 seconds of transcript from the buffer added in
    `add-system-audio-transcription`.
  - Builds a system prompt for the selected mode (`interview`, `meeting`,
    `sales`) per `docs/PRD.md` section 5.3 / `docs/TECHNICAL_DESIGN.md`
    section 4.8.
  - Sends one non-streaming chat completion request to the configured LLM
    provider (from `add-provider-settings`), requesting a JSON object
    response.
  - Parses the response into a fixed `AssistantSuggestion` struct.
  - Emits `assistant_done` with the suggestion, or `assistant_error` on
    failure.
- Wire the floating island's existing "Ask" button
  (`src/App.tsx`, currently opens the assistant panel with static preview
  copy) to call `ask_assistant` and render the real suggestion.

## Non-goals

- No streaming/SSE response handling. One request, one complete JSON
  response (see design.md for why this was chosen over streaming).
- No screenshot/vision input in this change (`capture_and_ask` and the
  vision LLM path are a separate future change, per
  `docs/MVP_DELIVERY_PLAN.md` M7).
- No `debug` mode (screen-analysis mode); only `interview`, `meeting`,
  `sales` — the three modes that only need transcript context.
- No conversation history across multiple Ask calls. Each Ask is a fresh
  request built only from the current transcript window.
