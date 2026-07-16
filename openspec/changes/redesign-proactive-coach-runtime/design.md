# Design: redesign-proactive-coach-runtime

Normative product behavior and the full implementation design live in:

- `docs/PROACTIVE_COACH_BEHAVIOR.md`
- `docs/PROACTIVE_COACH_RUNTIME_DESIGN.md`

This OpenSpec design records the decisions that implementation and review must
preserve.

## 1. Current And Target Flow

Current:

```text
transcript.final
  -> detectSttWake
  -> AgentRuntime.wake
  -> transport
  -> callback mutates UI
```

Target:

```text
meeting event
  -> event journal
  -> activity window
  -> signal detector
  -> deterministic wake policy
       -> ignored(reason)
       -> claimed wake
  -> user/proactive runtime arbitration
  -> spoken | silent | failed | superseded
  -> guarded presentation commit
```

## 2. Decision: Keep Orchestration In TypeScript

The React/TypeScript application layer owns:

- event journal and active activity window;
- signal detection and wake policy;
- queue, priority, interaction epoch, and cancellation arbitration;
- Agent prompt orchestration and presentation policy.

Rust owns:

- native system audio and microphone capability;
- STT and LLM provider commands;
- credential boundary;
- append-only local diagnostic write and transport cancellation support.

Reason: user intent and visible session state originate in the application
layer. Moving arbitration into Rust would duplicate state and reintroduce an
unclear ownership boundary.

## 3. Decision: Journal Facts Before Decisions

Every accepted raw event is recorded before signal detection. Every policy and
runtime transition references the source event ids.

The state model is:

```text
observed
  -> ignored(reason)
  -> running(reason, wakeId, runId)
       -> spoken
       -> silent
       -> failed
       -> superseded
```

P0 uses bounded in-memory state plus append-only
`~/.meetly/coach-events.jsonl`. No remote upload is introduced.

## 4. Decision: Gate And Agent Have Different Jobs

The deterministic gate answers:

> Is this evidence important and timely enough to spend an Agent run?

The Agent answers:

> Is there a useful intervention worth showing right now, and what is the
> shortest useful wording?

Therefore gate success does not imply visible output. User runs must answer;
low-priority proactive runs may return `SILENT`.

## 5. Decision: User Intent Preempts Proactive Work

Runtime state includes a monotonic `interactionEpoch`. Starting User Ask/Enter,
stopping a session, or switching session/capture configuration increments the
epoch.

On User Ask/Enter:

1. increment epoch;
2. abort the active proactive transport;
3. mark active and covered pending proactive work `superseded_by_user`;
4. keep useful transcript evidence in the user request context;
5. start the user run without waiting for proactive cleanup.

Every asynchronous callback validates current `sessionId`, epoch, and `runId`
before mutating UI. Abort alone is not trusted to stop a late provider result.

Presentation-only actions, including panel open/close and window drag, do not
increment the epoch.

## 6. Decision: Coalesce By Priority And Evidence

Only one proactive run executes at a time. While it runs, the runtime retains
at most one pending proactive wake chosen by:

1. highest priority;
2. materially new evidence;
3. newest occurrence time.

A new P1 wake may replace a pending P2/P3 wake. A repeated signal with the same
evidence key is ignored. User work is not stored in the proactive queue.

## 7. Decision: Scoped Spoken Cooldown

Cooldown is keyed by signal family and evidence key. Its clock starts after a
visible `spoken` result.

These transitions do not consume spoken cooldown:

- `session.started`;
- `ignored`;
- `silent`;
- `failed`;
- `superseded`.

P0 always bypasses cooldown. A materially different P1 event may bypass a
lower-priority cooldown.

## 8. Decision: Proactive Output Is Buffered

User-request deltas may stream into the user answer surface. Proactive deltas
remain buffered until the run completes and passes the commit guard.

This prevents a proactive draft from flashing immediately before Enter wins,
and avoids exposing partial low-confidence observations.

## 9. Decision: Capture Readiness Is A Policy Input

The runtime records `audio.capture.started` only after the selected source is
actually ready. Transcript-derived wakes are ignored with `capture_not_ready`
before that state.

Computer meetings default to system audio. Microphone remains an explicit
choice for in-room or speakerphone conversations. P0 does not pretend one audio
source provides complete two-party speaker attribution.

## 10. Stable Reasons

Policy and runtime reasons are stable protocol values, not prose:

```text
no_active_session
capture_not_ready
no_new_evidence
duplicate_evidence
signal_cooldown
lower_priority_in_flight
user_run_active
session_ended
superseded_by_user
superseded_by_session
request_timeout
run_failed
```

Human-readable diagnostics may explain these values, but tests and replay use
the stable protocol.

## 11. Migration

The change is incremental:

1. introduce protocol and event logging around current behavior;
2. add activity projection and deterministic policy;
3. route current detector output through the policy;
4. add epoch, abort propagation, and guarded callbacks;
5. introduce discriminated run outcomes and proactive `SILENT`;
6. replace global cooldown with scoped spoken cooldown;
7. migrate replay and log tools to the canonical runtime;
8. remove obsolete policy integration only after parity tests pass.

The current Coach UI remains in place during migration. No phase may leave two
independent runtimes capable of committing visible Coach messages.

## 12. Risks

### Too much logging

Mitigation: bounded evidence previews, file rotation, no raw audio, and no
remote upload.

### Cancellation does not stop native work

Mitigation: add transport cancellation where possible and require commit guards
even when native cancellation is unavailable.

### One-sided audio creates false assumptions

Mitigation: include source and speaker confidence in the activity window and
keep rules conservative until dual-source capture exists.

### `SILENT` hides useful failures

Mitigation: `silent` is a successful model judgment; transport errors remain
`failed` and are separately observable.

### Old tests stay green

Mitigation: canonical replay must import production modules. Tests of obsolete
policy modules are removed or explicitly classified as historical.

## 13. Execution Rule

Implementation follows `tasks.md` one bounded phase at a time. After each phase
is implemented and verified, stop for user confirmation before starting the
next phase.
