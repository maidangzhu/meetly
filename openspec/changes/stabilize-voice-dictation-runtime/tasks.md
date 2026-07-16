# Tasks: stabilize-voice-dictation-runtime

## 1. Documentation and Contracts

- [x] Document the OpenLess recording, ASR, polish, and delivery comparison.
- [x] Define the target Rust-owned Dictation coordinator boundary.
- [x] Define ASR batch/streaming capability contracts.
- [x] Define LLM completion/thinking/streaming capability contracts.
- [x] Define provider failure and delivery outcome semantics.
- [x] Validate this OpenSpec change.

## 2. Current Delivery Semantics

- [x] Replace boolean output interpretation with explicit pasted/copied/failed outcomes.
- [x] Treat clipboard copy fallback as successful completion in backend and UI.
- [x] Continue safe app-level `Cmd+V` when AX focused-element restoration is unavailable.
- [x] Ensure paste retry uses stored final text without rerunning STT or polish.
- [x] Add regression tests for auto-paste enabled plus copied fallback.
- [ ] Manually verify TextEdit, browser input, VS Code, Terminal, and Feishu.

Automated evidence (2026-07-16): `pnpm test:dictation`, `pnpm test:voice-ask`,
`pnpm test:wake`, `pnpm build`, `cargo test --lib`, `cargo check`, OpenSpec
validation, compact copied/failed browser previews, and `git diff --check` passed.

## 3. Rust Dictation Coordinator

- [ ] Add a pure coordinator state module with UUID session IDs.
- [ ] Add pending-stop, cancellation, and stale-continuation transitions.
- [ ] Move STT, polish, delivery ordering, and fallback decisions into Rust.
- [ ] Emit one serializable Dictation snapshot/event contract to React.
- [ ] Reduce React Dictation logic to event rendering and user intents.
- [ ] Keep the existing WebView recorder through a temporary `AudioArtifact` bridge.
- [ ] Add stage-by-stage cancellation and stale-result tests.

## 4. Provider Registry

- [ ] Add ASR and LLM capability models.
- [ ] Add normalized provider failure categories and retryability.
- [ ] Add independent active ASR and active LLM selection.
- [ ] Adapt the existing OpenAI-compatible STT provider to the ASR contract.
- [ ] Adapt the existing OpenAI-compatible LLM provider to the LLM contract.
- [ ] Add provider contract and diagnostics tests.
- [ ] Preserve existing settings and credential migration behavior.

## 5. Polish Reliability

- [ ] Add provider-aware timeout with a 30-second upper budget.
- [ ] Add provider-specific thinking control through LLM capabilities.
- [ ] Add bounded raw-transcript envelope and injection-defense prompt.
- [ ] Add output cleaning for reasoning tags, fences, and boilerplate.
- [ ] Return structured raw fallback metadata on timeout/error/empty output.
- [ ] Add tests proving successful STT text is never lost by polish.

## 6. Native Dictation Recorder

- [ ] Add native microphone capture using the selected Rust audio stack.
- [ ] Normalize input to 16 kHz mono signed 16-bit PCM.
- [ ] Emit audio-level events and add callback liveness monitoring.
- [ ] Add temporary private WAV archive lifecycle.
- [ ] Remove Dictation Blob/base64 transfer after parity verification.
- [ ] Test built-in, Bluetooth, and USB microphone behavior.

## 7. ASR Reliability and Additional Providers

- [ ] Add dynamic timeout derived from audio duration/provider limits.
- [ ] Add bounded retry from temporary archived audio.
- [ ] Add vocabulary/hotword forwarding where supported.
- [ ] Add provider-aware long-audio chunking and transcript joining.
- [ ] Add verbose-segment hallucination filtering only for providers that support it.
- [ ] Add the first realtime ASR adapter behind the streaming capability contract.
- [ ] Verify adding a provider does not change coordinator or UI state contracts.

## 8. Final Verification

- [ ] `pnpm test:dictation`
- [ ] `pnpm test:voice-ask`
- [ ] `pnpm test:wake`
- [ ] `pnpm build`
- [ ] `cargo test --lib`
- [ ] `cargo check`
- [ ] `npx @fission-ai/openspec validate stabilize-voice-dictation-runtime --type change`
- [ ] `git diff --check`
- [ ] Manual acceptance matrix completed.
