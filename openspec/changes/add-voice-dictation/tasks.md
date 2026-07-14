# Tasks: add-voice-dictation

执行规则：用户已明确授权本轮一把完成全部实现；人工验收项保持未勾选。未明确授权时不 commit、不 push。

## Step 1: macOS Output Spike

- [x] Add a Rust `dictation` module with a minimal output-test command.
- [x] Capture the frontmost target before showing any Meetly UI.
- [x] Write fixed test text to the clipboard.
- [x] Paste fixed test text into the captured target without sending Enter.
- [x] Fall back to clipboard-only when Accessibility is unavailable or the target is invalid.
- [x] Add a Settings diagnostic button for the fixed-text paste test.
- [ ] Verify manually in TextEdit, browser textarea, Feishu, VS Code, and Terminal.
- [x] Run `pnpm exec tsc --noEmit --pretty false`, `pnpm build`, and `cargo check`.

## Step 2: Dictation Domain and State Machine

- [x] Add Dictation settings, event payloads, run types, and defaults.
- [x] Add a pure reducer/state machine for idle, opening, recording, transcribing, polishing, pasting, copied, cancelled, and error.
- [x] Reject duplicate key-down, stale run results, and overlapping runs.
- [x] Handle release-before-recorder-ready and quick-tap cancellation.
- [x] Add deterministic offline tests for all transitions and failure mappings.
- [x] Verify TypeScript and Rust checks remain green.

## Step 3: Standard Shortcut Vertical Slice

- [x] Add a configurable standard global shortcut with `Option + Space` fallback.
- [x] Create and release one Rust run lease per shortcut activation.
- [x] Emit pressed/released/blocked events with run id.
- [x] Block Dictation while Meeting listening is active.
- [x] Register Escape only while a run is active.
- [x] Add shortcut registration diagnostics and conflict errors.
- [ ] Verify push-to-talk and toggle behavior with a fixed output payload.

## Step 4: Microphone Recording and STT

- [x] Extract a low-level microphone recorder helper from the current Ask implementation without sharing Ask state.
- [x] Add `useDictation` orchestration keyed by run id.
- [x] Record a complete WebM/Ogg clip and reuse `transcribe_audio`.
- [x] Stop all tracks and clear chunks on success, error, and cancel.
- [x] Do not write Dictation text to Meeting transcript or trigger Ask/Coach.
- [x] Paste raw transcription through the output service.
- [x] Add offline tests around stale completion, cancellation, and empty STT.
- [ ] Manually verify shortcut -> microphone -> STT -> paste.

## Step 5: AI Polish with Raw Fallback

- [x] Add a plain-text LLM completion path separate from `AssistantSuggestion`.
- [x] Add the Dictation cleanup prompt and output normalization.
- [x] Add a short timeout and disable reasoning where supported.
- [x] Fall back to raw transcription for timeout, network, config, empty-response, and parse failures.
- [x] Log timings and fallback reasons without logging secrets or full private text.
- [x] Add tests proving successful STT is never lost because AI fails.
- [ ] Manually verify Chinese, English, and mixed technical dictation.

## Step 6: Native Fn + Space

- [x] Add the macOS event-tap backend for `keyDown`, `keyUp`, and `flagsChanged`.
- [x] Recognize the function modifier and `Fn + Space`.
- [x] Suppress matched Space events so the target does not receive stray spaces.
- [x] Reset pressed state and re-enable the event tap after system timeout/interruption.
- [x] Keep the standard shortcut backend as a permission/conflict fallback.
- [x] Add matcher and transition tests for Fn, key repeat, quick release, and interruption.
- [ ] Manually verify push-to-talk and toggle modes.

## Step 7: Settings and Island UX

- [x] Add Dictation settings for shortcut, activation mode, AI polish, auto-paste, and clipboard retention.
- [x] Add microphone, Accessibility, shortcut, and paste diagnostics.
- [x] Add compact island states without opening/focusing the expanded panel.
- [x] Add copied/error recovery messages and automatic return to idle.
- [x] Update the microphone purpose string for Ask and user-triggered Dictation.
- [x] Keep Meeting transcript, Ask, Coach, and reports visually and behaviorally separate.
- [x] Run typecheck, build, Rust tests, and cargo check.

## Step 8: Acceptance and Closure

- [ ] Verify TextEdit, Safari/Chrome, Feishu, VS Code, and Terminal.
- [ ] Verify Accessibility-denied clipboard fallback.
- [ ] Verify target-app-closed fallback never pastes into a different app.
- [ ] Verify Escape and quick tap never paste partial text.
- [ ] Verify LLM failure pastes raw transcription.
- [ ] Verify an active Meeting session blocks Dictation and does not affect the call microphone path.
- [ ] Verify built-in mic, AirPods, and one external mic if available.
- [x] Run `pnpm exec tsc --noEmit --pretty false`.
- [x] Run `pnpm build`.
- [x] Run `cargo test`.
- [x] Run `cargo check`.
- [x] Run OpenSpec validation and `git diff --check`.
