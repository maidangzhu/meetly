# Proposal: add-interview-auto-assist-p1

## Why

Manual Ask is necessary but not sufficient for a smooth interview assistant.
In live interviews the user may not press Enter quickly enough when the
interviewer asks a question. Meetly should recognize likely answer moments
and offer help without interrupting the conversation.

P1 adds low-interruption automatic assistance on top of the stabilized P0
interview session.

## What

- Detect question-like interviewer prompts from final transcript segments.
- Show a small, low-distraction hint such as `Question detected · Press Enter`
  instead of automatically expanding a full answer.
- Optionally pre-generate an answer in the background for high-confidence
  question candidates.
- Cache the pre-generated answer for a short time so pressing Enter can show
  it quickly.
- Add cooldown, dedupe, and expiry so the UI does not spam the user.
- Keep automatic behavior configurable and safe:
  - default behavior: hint only;
  - prefetch can run silently;
  - full auto-answer remains off by default.

## Non-goals

- No fully autonomous answering by default.
- No proactive web search.
- No screen capture automation.
- No long-term memory retrieval.
- No diarization implementation, though the detector should be ready to use
  speaker labels when they become available.

