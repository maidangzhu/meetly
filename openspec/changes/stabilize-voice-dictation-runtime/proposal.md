# Proposal: stabilize-voice-dictation-runtime

## Why

The first Voice Dictation vertical slice proved that Meetly can record from a
global shortcut, transcribe, polish, copy, and paste. Real use exposed a weaker
runtime boundary:

- recording and workflow orchestration are owned by React while shortcut,
  target, and delivery state are owned by Rust;
- a successful clipboard copy can be displayed as a failed run when automatic
  paste does not complete;
- Accessibility focused-element restoration is treated as more authoritative
  than the non-activating overlay and app-level paste path;
- Dictation polish has a fixed eight-second timeout and only minimal output
  cleanup;
- microphone audio is transferred as a compressed Blob encoded to base64;
- the existing STT trait is batch-only and provider capabilities/errors are not
  modeled for future realtime or local providers;
- LLM providers share configuration, but Dictation lacks a provider-aware
  timeout, thinking, retry, and response-cleaning policy.

Meetly will need multiple ASR and LLM providers. The next change must therefore
stabilize the current workflow while establishing provider contracts that can
grow without rewriting Dictation again.

## What

- Add a Rust-owned Dictation coordinator as the authoritative session state.
- Give every run a UUID session ID and reject stale asynchronous results.
- Define explicit outcomes for transcription, polish fallback, and delivery.
- Treat successful clipboard copy as a successful `copied` terminal outcome,
  even when auto-paste is enabled but cannot complete.
- Make Accessibility focused-element restoration best effort rather than a
  prerequisite for macOS `Cmd+V`.
- Add first-class ASR provider capabilities for batch and streaming modes.
- Add first-class LLM provider capabilities for plain-text completion,
  streaming support, and thinking control.
- Normalize provider errors, retryability, diagnostics, and cancellation.
- Move Dictation STT, polish, delivery ordering, cancellation, and retry policy
  from React into the Rust coordinator.
- Keep the existing `MediaRecorder` path temporarily behind an audio artifact
  boundary, then migrate Dictation to native 16 kHz mono PCM capture.
- Add provider-aware polish timeout, raw fallback, transcript envelope, and
  output cleaning.
- Add temporary private audio archiving for ASR retry without changing the
  product default to permanent audio retention.

## Non-goals

- No change to Meeting system-audio capture or the TypeScript Agent runtime.
- No immediate implementation of every planned ASR or LLM provider.
- No provider marketplace, local-model downloader, or Style Pack marketplace.
- No per-token simulated keyboard insertion in the first stable runtime.
- No automatic Enter, message submission, or form submission.
- No release, commit, or push as part of this documentation step.

## Success Criteria

- Rust is the single authoritative owner of a Dictation run lifecycle.
- React can render Dictation state without independently sequencing backend
  stages.
- A copied fallback is never shown as a failed transcription or failed polish.
- Retrying delivery never reruns ASR or LLM polish.
- Provider adapters can declare batch/streaming, hotword, partial-result,
  thinking-control, and streaming-completion capabilities.
- Provider errors identify provider, stage, category, retryability, and a safe
  diagnostic code.
- Polish failure always preserves and delivers raw transcription when possible.
- Existing OpenAI-compatible STT and LLM configuration continues to work as the
  first provider adapters.
- The migration can proceed in independently verifiable steps without changing
  Meeting, Voice Ask, or Coach behavior.

