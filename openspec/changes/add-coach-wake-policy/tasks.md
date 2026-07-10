# Tasks: add-coach-wake-policy

## 1. Policy Core

- [x] Add `src/app/coachWakePolicy.ts`.
- [x] Define `CoachWakeDecision`, `CoachWakeSignal`, and `CoachWakeState`.
- [x] Add pure policy functions for transcript events and heartbeat events.
- [x] Track last observed segment id/end time for logging and prompt context.
- [x] Return structured wake/skip reasons for empty transcript, in-flight coach, duplicate question, and heartbeat observation.

## 2. Integration

- [x] Route transcript-based question candidates through `coachWakePolicy`.
- [x] Route the 10 second heartbeat through `coachWakePolicy` before calling PI.
- [x] Update `usePiCoach` to mark observed transcript after visible output or `SILENT`.
- [x] Preserve Enter/manual Ask priority.
- [x] Keep existing prefetch behavior intact.
- [x] Remove hardcoded fallback coach messages so PI output is model-decided.

## 3. Observability

- [x] Add `[coach-policy]` debug logs for each wake/skip decision.
- [x] Include signal, reason, trigger, candidate id, segment id, and timing.
- [x] Avoid logging API keys or long transcript bodies.
- [ ] Include policy events in session report summary when useful.

## 4. Test Harness

- [x] Add deterministic test fixtures for wake policy replay.
- [x] Add `scripts/replay-coach-wake-policy.ts`.
- [x] Add `pnpm test:wake` script.
- [x] Keep replay tests offline and deterministic.
- [x] Keep `pnpm test:flow` for real provider path.

## 5. P0 Test Cases

- [x] Clear technical question wakes.
- [x] Behavioral prompt wakes.
- [x] Filler transcript skips.
- [x] Heartbeat with empty transcript skips.
- [x] Heartbeat with existing transcript observes via `fresh_context`.
- [x] Duplicate question skips.
- [x] Silence after question wakes.
- [x] Long answer wakes.
- [x] In-flight coach skips.
- [x] `SILENT` result marks observed context.

## 6. Verification

- [x] `pnpm test:wake`
- [x] `pnpm build`
- [x] `pnpm test:flow`
- [ ] Manual test: 5 minute mock interview, no more than two false visible hints.
- [ ] Manual test: question followed by silence triggers a short rescue hint.
- [ ] Manual test: Enter still returns direct answer and does not stop recording.

## 7. Rollout

- [x] Ship P0 with conservative thresholds.
- [ ] Review debug logs from at least 3 real or mock sessions.
- [ ] Add missed/false cases back into replay fixtures.
- [ ] Only then enable P1 signals like answer drift as visible hints.
