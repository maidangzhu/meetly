# Tasks: add-system-audio-transcription

- [x] Add `reqwest` (features: `multipart`, `json`) and `hound` to `src-tauri/Cargo.toml`.
- [x] Add `src-tauri/src/audio/vad.rs`: port Pluely's energy-threshold segmenter (hop chunking, noise gate, pre-speech rolling buffer, min-speech/silence/max-segment thresholds from `docs/TECHNICAL_DESIGN.md` section 4.4).
- [x] Add `src-tauri/src/audio/transcript_buffer.rs`: `TranscriptSegment`, `TranscriptBuffer` with 3-minute eviction and a `recent(window_ms)` reader.
- [x] Add WAV encoding helper (16-bit mono, reuse the live sample rate) using `hound`. (`src-tauri/src/audio/wav.rs`)
- [x] Add `src-tauri/src/providers/stt/mod.rs`: `SttProvider` trait.
- [x] Add `src-tauri/src/providers/stt/openai_compatible.rs`: multipart POST implementation, reads `base_url`/`model` from `add-provider-settings` config and API key from keyring.
- [x] Extend `AudioState`/`run_level_capture` in `src-tauri/src/audio/mod.rs` to feed samples through the VAD segmenter alongside the existing level metering.
- [x] Spawn per-segment transcription as an independent `tokio::spawn` task; do not block the capture loop.
- [x] Emit `speech_segment_started`, `transcript_final`, `transcript_error` events.
- [x] Register `get_recent_transcript` command in `src-tauri/src/lib.rs`.
- [x] Update floating island UI (`src/App.tsx`) to subscribe to `transcript_final` and render real segments in the ticker and the expanded panel's transcript list, replacing the static placeholder text.
- [x] Handle "no API key configured" case: `transcript_error` with a clear message ("No API key configured for stt"); island shows it inline in the ticker.
- [x] Run frontend build.
- [x] Run Rust check.
- [x] Added unit tests for `vad::Segmenter` (discard-short-burst, segment-on-silence, force-flush-at-max-duration) and `wav::encode_wav` (empty/invalid/valid cases) and `transcript_buffer` (window filtering, eviction) — all passing (`cargo test --lib`).
- [ ] Manual test: play spoken audio into the system output, confirm a `transcript_final` event with correct text arrives within a few seconds of pausing. (Not run — requires a configured STT API key and live audio playback.)
- [ ] Manual test: unplug network mid-segment, confirm `transcript_error` fires and capture loop keeps running (level meter still updates). (Not run — requires live network manipulation during a capture session.)
