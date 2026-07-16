# Proactive Coach Runtime Design

Status: implementation design for
`openspec/changes/redesign-proactive-coach-runtime`.

Product behavior: `docs/PROACTIVE_COACH_BEHAVIOR.md`.

## 1. Context

The current TypeScript runtime has useful pieces:

- `ContextStore` retains bounded transcript and session context;
- `detectSttWake` recognizes questions and meeting signal families;
- `AgentRuntime` provides priority ordering, in-flight coalescing, timeout retry,
  and UI callbacks;
- `useAgentRuntime` connects final transcript segments to the runtime.

However, final transcripts currently connect directly to wakes. There is no
structured observation ledger, the cooldown is global, `session_start` can
suppress an early transcript wake, the prompt forbids `SILENT`, and cancellation
does not define complete user-vs-proactive arbitration.

The earlier `add-coach-wake-policy` change described a React heartbeat and
`usePiCoach` runtime that is no longer active. This design keeps Agent
orchestration in TypeScript and replaces that historical path with an
event-driven local runtime.

## 2. Goals

- Make capture, signal detection, wake gating, Agent judgment, and presentation
  separately observable.
- Define user-intent preemption as a runtime invariant.
- Allow low-priority proactive runs to complete as `SILENT`.
- Prevent late or cancelled results from mutating current UI or session state.
- Keep meeting response latency appropriate for live conversation.
- Use one canonical runtime path for the app, replay tests, and diagnostics.

## 3. Non-goals

- No multi-agent orchestration.
- No server-side event database, SSE transport, or copy of the Hat API.
- No always-on model heartbeat without new evidence.
- No automatic OS actions, meeting controls, or memory writes.
- No promise of perfect speaker diarization in the first implementation.
- No migration of audio capture or provider credentials into TypeScript.

## 4. Architecture

```text
Rust/native capture or browser microphone
  -> transcript.finalized
  -> CoachEventJournal.append
  -> ActivityWindow.project
  -> SignalDetector.detect
  -> WakePolicy.decide
       -> ignored(reason)
       -> claim(wake)
  -> AgentRuntime.run
       -> spoken
       -> silent
       -> failed
       -> superseded
  -> PresentationPolicy.commit
```

React/TypeScript owns the event journal, activity projection, policy, runtime
arbitration, and presentation decisions. Rust continues to own native capture,
STT/LLM provider calls, credentials, and cancellable command boundaries.

## 5. Core Types

```ts
type CoachEventType =
  | "session.started"
  | "audio.capture.started"
  | "audio.capture.failed"
  | "transcript.finalized"
  | "speaker.turn.completed"
  | "silence.elapsed"
  | "user.manual_ask"
  | "session.ended";

type CoachEvent = {
  id: string;
  sessionId: string;
  type: CoachEventType;
  occurredAtMs: number;
  source?: "microphone" | "system" | "ui" | "runtime";
  segmentId?: string;
  speaker?: "user" | "other" | "unknown";
  evidencePreview?: string;
  payload?: Record<string, unknown>;
};

type CoachSignal = {
  id: string;
  sessionId: string;
  kind:
    | "question_detected"
    | "objection_raised"
    | "commitment_detected"
    | "decision_window"
    | "goal_drift"
    | "unresolved_topic"
    | "user_stalled"
    | "answer_drift"
    | "fresh_context";
  priority: 1 | 2 | 3;
  evidenceEventIds: string[];
  evidenceKey: string;
  createdAtMs: number;
};

type WakeDecision =
  | { type: "ignore"; reason: WakeIgnoreReason }
  | { type: "wake"; wake: CoachWake };

type CoachWake = {
  id: string;
  sessionId: string;
  kind: "proactive" | "user";
  priority: 0 | 1 | 2 | 3;
  reason: string;
  evidenceEventIds: string[];
  evidenceKey: string;
  createdAtMs: number;
};
```

`evidencePreview` is bounded and sanitized. Full transcript remains in the
existing session/context store and is referenced by segment id.

## 6. Event Journal

`CoachEventJournal` records observations before policy evaluation so a missing
response can be traced to capture, policy, runtime, or presentation.

P0 storage:

- keep the active session window in memory;
- append structured JSON lines to `~/.meetly/coach-events.jsonl` through a
  narrow Tauri logging command;
- rotate or truncate by size and never store raw audio;
- retain `~/.meetly/debug.log` for human-readable operational diagnostics.

The journal lifecycle is:

```text
observed
  -> ignored
  -> running
       -> spoken
       -> silent
       -> failed
       -> superseded
```

Each transition includes `eventId`, `wakeId`, optional `runId`, reason, and
timing. A run never disappears from the trace because the UI stayed quiet.

## 7. Activity Window And Signal Detection

The activity window projects the last 60-120 seconds of accepted events plus:

- session kind and meeting objective;
- selected and confirmed audio source;
- recent transcript segments in capture order;
- latest user and other-speaker turn times;
- unresolved question, objection, commitment, and decision evidence;
- last spoken Coach message and covered evidence keys;
- current interaction epoch and active run kind.

Signal detection is pure and offline-testable. It may use regex and timing as
features, but returns typed signals with evidence rather than directly calling
the Agent.

P0 signal order:

1. direct question;
2. meeting objection, commitment, scope/ownership, timeline, or decision;
3. silence after a question;
4. duplicate suppression;
5. fresh context only when new evidence exists.

`goal_drift`, `unresolved_topic`, and `answer_drift` begin as trace-only signals
until replay data shows acceptable false-positive rates.

## 8. Deterministic Wake Policy

The policy is a pure function over an activity window and runtime snapshot.

```ts
type RuntimeSnapshot = {
  sessionId: string | null;
  interactionEpoch: number;
  activeRun: { kind: "proactive" | "user"; priority: number } | null;
  pendingWake: CoachWake | null;
  lastSpokenBySignal: Partial<Record<CoachSignal["kind"], number>>;
  coveredEvidenceKeys: string[];
};
```

Ignore reasons are stable protocol values:

```text
no_active_session
capture_not_ready
no_new_evidence
duplicate_evidence
signal_cooldown
lower_priority_in_flight
user_run_active
session_ended
```

Policy rules:

- user wakes have priority 0 and are never rejected by proactive cooldown;
- session lifecycle events do not create a proactive run;
- cooldown uses the last `spoken` transition for the relevant signal family;
- `silent`, `failed`, and `superseded` do not consume spoken cooldown;
- a materially different P1 signal may bypass a weaker cooldown;
- one pending proactive wake is retained by highest priority, then recency;
- duplicate evidence never creates a second visible message.

## 9. Concurrency And User Preemption

The runtime maintains a monotonically increasing interaction epoch.

```ts
type ActiveCoachRun = {
  runId: string;
  wakeId: string;
  sessionId: string;
  kind: "proactive" | "user";
  priority: number;
  epoch: number;
  abortController: AbortController;
};
```

### 9.1 Starting proactive work

1. Evaluate the deterministic gate.
2. Atomically claim the wake only if session, epoch, and active-run state are
   unchanged.
3. Record `running` before calling transport.
4. Do not stream proactive deltas into a visible Coach card.
5. Buffer the result until it passes the commit guard.

### 9.2 Starting a user request

1. Increment `interactionEpoch`.
2. Abort the active proactive controller.
3. Mark the proactive wake and run `superseded_by_user`.
4. Remove pending proactive wakes covered by the same evidence.
5. Build the user request with latest transcript and useful wake evidence.
6. Start the user run immediately.

### 9.3 Commit guard

Before any delta, message, error, tool state, or thinking state mutates UI, the
callback verifies:

```ts
run.sessionId === currentSessionId
  && run.epoch === interactionEpoch
  && activeRun?.runId === run.runId
```

For proactive runs, only the final buffered result is committed. A provider
that ignores cancellation may finish, but its result is discarded and remains
`superseded` in the journal.

Session stop and source/session changes also increment the epoch and abort all
active work. Presentation-only actions do not.

## 10. Agent Judgment

The prompt receives wake reason, meeting objective, bounded transcript,
evidence that passed the gate, recent Coach messages, and evidence already
covered.

User runs MUST return an answer or a user-readable error. Proactive runs MAY
return `SILENT`, except for explicitly configured must-speak P1 cases.

```ts
type CoachRunOutcome =
  | { type: "spoken"; suggestion: AssistantSuggestion }
  | { type: "silent" }
  | { type: "failed"; message: string }
  | { type: "superseded"; reason: string };
```

An empty answer is not automatically an error for proactive runs. The literal
`SILENT` token is runtime protocol and is never persisted as a visible message.

## 11. Presentation Policy

- `spoken`: add, replace, or merge a concise Coach message;
- `silent`: clear transient thinking state without adding a card;
- `failed`: expose an actionable error only when useful to the user;
- `superseded`: clear stale transient state silently;
- user answer: always wins the current answer surface;
- proactive result: never appears after a newer user request.

Thinking UI begins only after a wake is claimed, not whenever an event is
observed. Internal policy labels remain diagnostic-only.

## 12. Audio Preconditions

- Computer meetings default to system audio.
- Microphone is explicit for in-room or speakerphone conversations.
- `audio.capture.started` is required before transcript-derived policy runs.
- Capture failure produces a source-specific error and trace event.
- P0 may use one audio source, but speaker confidence remains explicit; policy
  must not pretend it heard both sides.
- Dual-source capture and diarization are follow-up work, not hidden P0
  assumptions.

## 13. Replay And Verification

The canonical replay harness imports the same event projection, detector, and
wake policy as the app. Historical tests for an unused policy do not satisfy
this design.

Required deterministic scenarios:

- no capture or no transcript;
- meeting question without user action;
- objection and commitment signals;
- session start followed immediately by a P1 signal;
- repeated evidence and scoped cooldown;
- proactive run followed by Enter;
- Enter and proactive completion in the same tick;
- provider ignores abort and returns late;
- session stop during a run;
- proactive `SILENT` followed by materially new evidence;
- simultaneous proactive wakes with different priorities.

Integration verification includes runtime replay, transport timeout and abort,
React stale-callback tests, browser state checks, and a live Tauri meeting trace.

## 14. Rollout

1. Add event and transition logging without changing visible behavior.
2. Move the detector behind the canonical activity window and policy.
3. Add interaction epoch, abort propagation, and stale callback guards.
4. Restore `SILENT` for low-priority proactive runs.
5. Remove session-start speech from transcript cooldown accounting.
6. Switch replay and log diagnostics to the canonical runtime.
7. Enable P1 meeting signals with conservative thresholds.
8. Review real traces before enabling trace-only P2 signals visibly.
