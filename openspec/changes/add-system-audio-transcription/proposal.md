# Proposal: add-system-audio-transcription

## Why

`add-audio-capture-status` (already shipped) only reports audio levels; it
does not turn captured system audio into text. Meetly's core loop needs
actual transcript segments so the LLM (`add-llm-suggestions`) has something
to work with. This change adds the missing link: energy-threshold VAD over
the existing CoreAudio Process Tap stream, WAV encoding of detected speech,
and a one-shot HTTP call to an OpenAI-Whisper-compatible STT endpoint.

## What

- Add VAD segmentation on top of the existing `audio::speaker` PCM stream
  (`src-tauri/src/audio/speaker/macos.rs`, already captures system output via
  Core Audio Process Tap + Aggregate Device — unchanged).
  - Energy threshold + min speech duration + trailing silence detection,
    matching the parameters already specified in
    `docs/TECHNICAL_DESIGN.md` section 4.4.
- On segment end, encode the buffered `f32` samples to a 16-bit mono WAV
  in memory.
- POST the WAV to the configured STT endpoint (from `add-provider-settings`)
  as `multipart/form-data`, OpenAI-Whisper-compatible shape
  (`file`, `model`), and read `response.text` as the transcript.
- Maintain an in-memory rolling transcript buffer (last 3 minutes) for the
  LLM to read from later.
- Emit Tauri events: `speech_segment_started`, `transcript_final`,
  `transcript_error`.
- Extend the floating island UI to show the live transcript ticker using
  real segments instead of the current static "Listening" placeholder text.

## Non-goals

- No streaming/WebSocket STT. Segments are batch-transcribed after the
  speaker finishes a phrase (see design.md for the latency trade-off this
  implies, already agreed with the user).
- No microphone capture. System audio (the other meeting participants) only,
  per `docs/PRD.md` section 4.2 and `docs/PROJECT_RULES.md`.
- No partial/interim transcript events. Every `transcript_final` event is a
  complete phrase; there is no `transcript_partial`.
- No persistence of transcript text to disk by default (matches
  `docs/PRD.md` section 10).
- No neural VAD (Silero/WebRTC VAD). Energy threshold only, as already
  decided in `docs/TECHNICAL_DESIGN.md` section 4.4.
