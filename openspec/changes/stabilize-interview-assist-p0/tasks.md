# Tasks: stabilize-interview-assist-p0

## 1. Session State

- [x] Add an explicit in-memory interview session object.
- [x] Start a new session when the microphone button is clicked from idle.
- [x] Clear previous transient transcript and assistant result on new session.
- [x] Stop the active session when the microphone button is clicked while listening.
- [x] Log session start/stop to `~/.meetly/debug.log`.

## 2. Audio Segment Reliability

- [x] Ensure every microphone segment sent to STT is a complete audio blob.
- [x] Store segment `startMs` and `endMs` before STT begins.
- [x] Insert returned transcript segments by capture timestamp.
- [x] Add overlap or an acceptable P0 boundary-loss mitigation.
- [x] Suppress obvious duplicate transcript caused by overlap.

P0 uses complete blobs, capture timestamps, Ask-time flush, and duplicate suppression as the boundary-loss mitigation. True audio overlap remains a later audio-quality improvement.

## 3. Ask Flush

- [x] On Ask/Enter, stop the current recorder segment if it is recording.
- [x] Wait for the current segment's STT result before context assembly.
- [x] Restart microphone capture after flush if the session is still active.
- [x] Surface a clear message when no transcript exists yet.

## 4. Context Assembly

- [x] Add latest-question/latest-transcript detector.
- [x] Build Ask prompt with latest block, recent block, and full-session block.
- [x] Include all transcript while token usage remains small.
- [x] Log context metadata and head/tail previews.

## 5. Verification

- [x] `pnpm build`
- [ ] Manual test: start interview, speak a question, press Enter mid-segment, verify latest question is included.
- [ ] Manual test: speak across a chunk boundary, verify transcript is not badly cut or duplicated.
- [ ] Manual test: STT returns segments out of order, verify UI and Ask context remain chronological.
