# Tasks: redesign-proactive-coach-runtime

Execution rule: complete and verify one numbered phase, then stop for user
confirmation before beginning the next phase.

## 0. Design Baseline

- [x] Define normative proactive Coach behavior.
- [x] Define the local event-driven runtime architecture.
- [x] Specify user-vs-proactive race behavior.
- [x] Specify event lifecycle, stable reasons, and rollout order.
- [x] Validate this OpenSpec change.

## 1. Event And Trace Protocol

- [x] Add typed `CoachEvent`, `CoachSignal`, `CoachWake`, and run outcome types.
- [x] Add stable ignore, failure, and supersede reason enums/unions.
- [x] Add an in-memory bounded `CoachEventJournal` per active session.
- [x] Record session, capture, accepted transcript, manual Ask, and session-end events.
- [x] Add structured transition records for `ignored/running/spoken/silent/failed/superseded`.
- [x] Add a redacted JSONL append path for `~/.meetly/coach-events.jsonl`.
- [x] Add rotation/size limits and tests proving secrets/raw audio are not logged.
- [x] Verify current visible behavior is unchanged in this phase.

## 2. Activity Window And Signal Detector

- [ ] Add a pure bounded activity-window projection.
- [ ] Move current question and meeting signal features behind the projection.
- [ ] Return typed signals with evidence event ids and normalized evidence keys.
- [ ] Add P0 signals for question, objection, commitment, scope/ownership, timeline, and decision.
- [ ] Keep goal drift, unresolved topic, and answer drift trace-only initially.
- [ ] Add deterministic tests for source, timing, confidence, and dedupe behavior.
- [ ] Verify no signal calls the Agent directly.

## 3. Deterministic Wake Policy

- [ ] Add a pure wake policy over activity window plus runtime snapshot.
- [ ] Add P0-P3 priorities and stable ignore reasons.
- [ ] Require capture-ready state before transcript-derived wakes.
- [ ] Ensure session lifecycle does not create a proactive message.
- [ ] Replace global cooldown with per-signal/evidence spoken cooldown.
- [ ] Ensure `silent/failed/superseded/session_start` do not consume spoken cooldown.
- [ ] Coalesce pending proactive wakes by priority, evidence, and recency.
- [ ] Add a P1 bypass for materially different critical evidence.

## 4. User Preemption And Runtime Arbitration

- [ ] Add monotonic `interactionEpoch` to the active session runtime.
- [ ] Add `sessionId`, epoch, run id, kind, priority, and AbortController to active runs.
- [ ] Make User Ask/Enter increment epoch and abort active proactive work.
- [ ] Mark aborted proactive work `superseded_by_user`.
- [ ] Remove pending proactive wakes covered by the same user request evidence.
- [ ] Preserve useful proactive evidence in the user request context.
- [ ] Add commit guards to delta, message, error, tool, thinking, and retry callbacks.
- [ ] Invalidate work on session stop, session replacement, and capture-source change.
- [ ] Do not invalidate work for panel, drag, or other presentation-only actions.

## 5. Run Outcomes And Presentation

- [ ] Replace implicit answer/error handling with discriminated run outcomes.
- [ ] Allow low-priority proactive runs to return `SILENT`.
- [ ] Require User Ask/Enter runs to answer or return a user-readable error.
- [ ] Buffer proactive output until completion and commit validation.
- [ ] Ensure ignored, silent, and superseded work creates no Coach card.
- [ ] Ensure a late proactive result cannot overwrite or appear after a user answer.
- [ ] Add replace/merge behavior for newer high-priority proactive messages.
- [ ] Keep internal wake and signal labels out of user-facing copy.

## 6. Meeting Audio Preconditions

- [x] Default computer meeting mode to system audio.
- [x] Keep microphone explicit for in-room or speakerphone conversations.
- [ ] Emit `audio.capture.started` only after the selected source is ready.
- [ ] Emit and display a source-specific capture failure.
- [ ] Keep source and speaker confidence explicit in activity windows and prompts.
- [ ] Verify no policy assumes both sides were captured from one source.

## 7. Canonical Replay And Diagnostics

- [ ] Rewrite `pnpm test:wake` to import production projection, detector, and policy.
- [ ] Update Coach log replay to parse the current structured protocol.
- [ ] Remove or clearly retire tests that only cover the obsolete runtime path.
- [ ] Cover session-start/P1 cooldown regression.
- [ ] Cover Wake plus Enter before claim, during run, and same-tick completion.
- [ ] Cover a provider that ignores abort and returns late.
- [ ] Cover session stop/source change during a run.
- [ ] Cover scoped cooldown, priority coalescing, and proactive `SILENT`.
- [ ] Print per-scenario ignored/spoken/silent/failed/superseded summaries.

## 8. Verification

- [ ] Run targeted policy/runtime unit tests.
- [ ] Run canonical replay tests offline.
- [ ] Run transport timeout and cancellation tests.
- [ ] Run React stale-callback and presentation tests.
- [ ] Run `pnpm build`.
- [ ] Run relevant Rust tests and `cargo check`.
- [ ] Browser-check meeting setup and Coach state transitions.
- [ ] Live-test a Tauri system-audio meeting and inspect its structured trace.
- [ ] Confirm Git diff contains no unrelated changes.

## 9. Rollout

- [ ] Review at least three real or mock meeting traces.
- [ ] Add missed and false interventions to replay fixtures.
- [ ] Keep trace-only P2 signals hidden until evidence supports enabling them.
- [ ] Update the historical wake document with final migration status.
- [ ] Archive/supersede obsolete policy code only after canonical parity is proven.
