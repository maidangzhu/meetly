# Proposal: add-audio-capture-status

## Why

The floating island currently shows a simulated listening state. Meetly needs a small native audio status bridge before real system audio capture, STT, or LLM suggestions can be implemented safely.

## What

- Add Rust commands for `start_listening`, `stop_listening`, and `get_audio_status`.
- Detect platform and default audio devices.
- Keep listening state in Rust.
- Surface setup/error state in the floating island and diagnostics panel.

## Non-goals

- No PCM stream capture.
- No VAD.
- No STT provider integration.
- No LLM answer generation.
- No screenshot capture.
