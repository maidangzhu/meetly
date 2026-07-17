# Proactive Coach Behavior

Status: normative product behavior for the next Coach runtime iteration.

Related documents:

- `docs/PROACTIVE_COACH_RUNTIME_DESIGN.md`
- `docs/AGENT_WAKE_STRATEGY.md` (historical research and earlier design)
- `openspec/changes/redesign-proactive-coach-runtime/`

## 1. Definition

Meetly's Proactive Coach continuously observes a live conversation, turns new
evidence into structured events, and intervenes automatically when a concise
message can materially help the user.

Proactive behavior does not mean calling the model for every transcript or
forcing a visible message after every wake. It means:

1. relevant meeting activity is collected even when the user does nothing;
2. a deterministic policy decides whether the activity is worth evaluating;
3. the Coach may speak without a click or key press;
4. low-confidence observations may end in `SILENT`;
5. user intent always takes priority over background observation;
6. every ignored, silent, spoken, failed, or superseded result is explainable.

The desired interaction is a quiet field coach, not a chatbot and not a status
reporter. The user is already occupied by a meeting, so an intervention must be
short, timely, specific, and immediately usable.

## 2. Product Contract

The product SHALL separate these decisions:

```text
Something happened
  != the Coach should run
  != the Coach should speak
  != the UI should show a new card
```

The layers are:

```text
meeting event journal
  -> semantic activity window
  -> deterministic wake gate
  -> Coach judgment
  -> presentation policy
```

Each layer owns one decision and records its result. No prompt is allowed to
hide missing capture, an over-broad cooldown, a concurrency race, or a UI write
failure.

## 3. Observed Events

Raw events record facts. They do not call the model directly.

| Event | Meaning |
|---|---|
| `session.started` | A new interview or meeting session exists. |
| `audio.capture.started` | The selected audio source is actually producing capture input. |
| `audio.capture.failed` | Capture could not start or stopped unexpectedly. |
| `transcript.finalized` | A final transcript segment was accepted after dedupe. |
| `speaker.turn.completed` | A coherent speaker turn can be evaluated. |
| `silence.elapsed` | A meaningful silence threshold elapsed after a question or objection. |
| `user.manual_ask` | The user explicitly requested an answer inside the active meeting through Ask/Enter. |
| `session.ended` | The live session is no longer allowed to produce Coach output. |

The journal SHOULD include source, speaker confidence, segment ids, timestamps,
and a bounded evidence preview. It MUST NOT contain API keys, authorization
headers, or complete raw audio.

## 4. Semantic Signals

The signal detector derives meaning from a bounded recent activity window.
Meeting mode SHOULD support at least:

| Signal | Typical evidence |
|---|---|
| `question_detected` | A direct or implied question needs a response. |
| `objection_raised` | The other party expresses concern or rejection. |
| `commitment_detected` | Price, scope, ownership, timeline, or delivery is being committed. |
| `decision_window` | The conversation is ready for confirmation or closure. |
| `goal_drift` | The conversation is moving away from the stated meeting objective. |
| `unresolved_topic` | An important issue has repeated without resolution. |
| `user_stalled` | A question is followed by a useful rescue window. |
| `answer_drift` | The user's response is long or no longer addresses the question. |
| `fresh_context` | New evidence exists but no stronger semantic signal was found. |

Signals contain evidence and confidence. Keywords may contribute evidence, but
one keyword match is not the definition of a meeting event.

## 5. Wake Priority

| Priority | Trigger | Expected behavior |
|---|---|---|
| P0 | `user.manual_ask` | Preempt proactive work and produce a direct answer. |
| P1 | New question, strong objection, risky commitment, decision window | Evaluate immediately; may bypass ordinary cooldown. |
| P2 | Goal drift, unresolved topic, user stalled, answer drift | Evaluate when evidence and timing are sufficient. |
| P3 | Fresh-context observation | Low-priority evaluation; `SILENT` is normal. |
| P4 | Session lifecycle | Initialize or close state; do not create a default Coach message. |

`session.started` SHALL NOT consume the cooldown used by transcript-derived
signals. A welcome message is not a substitute for reacting to the meeting.

## 6. User Intent And Wake Races

Meeting-session user intent always wins inside the Coach runtime. This applies
to manual meeting Ask/Enter, stopping the session, changing the active meeting
session, and changing meeting capture configuration. Opening a panel, dragging
a window, or other presentation-only actions do not preempt the Coach.

Fn Voice Ask is an independent general Agent workflow. It is outside the Coach
wake policy: Fn does not preempt, suppress, suspend, resume, or otherwise alter
Coach work, and Coach does not alter an Fn run. The two workflows may run
concurrently and validate their own result publication independently.

| Race | Required result |
|---|---|
| User Ask arrives before a proactive wake is claimed | Ignore or remove the proactive wake and include its evidence in the user request context. |
| User Ask arrives while a proactive run is executing | Abort the proactive run, mark it `superseded`, and start the user run. |
| User Ask and proactive completion happen together | Only the result belonging to the newest interaction epoch may write to UI or session messages. |
| The same transcript causes both Wake and Enter | Produce one user-request answer, not two competing Coach messages. |
| Session stops while work is queued or running | Cancel queued and running work; reject all late callbacks for the old session. |
| Audio source or session changes | Create a new runtime epoch and invalidate old capture, wake, and result state. |

Aborting the transport is necessary but insufficient. Every asynchronous UI
write MUST validate both `sessionId` and `interactionEpoch`, because an
underlying provider may finish after cancellation.

## 7. Speaking Policy

Passing the wake gate means the context is worth evaluating. It does not always
mean the user should be interrupted.

The Coach MUST speak for:

- explicit user Ask/Enter;
- a direct question when the user needs an answer;
- a high-confidence critical risk where silence would lose immediate value.

The Coach MAY return `SILENT` for:

- low-priority fresh-context observation;
- repeated evidence already covered by a recent message;
- incomplete or low-confidence transcript context;
- an event that is relevant but has no useful next action yet.

Visible output SHOULD be one short action followed by an optional directly
usable sentence. It MUST NOT expose internal labels such as `wake`, `signal`,
`cooldown`, or `SILENT`.

## 8. Cooldown And Dedupe

Cooldown exists to reduce interruption, not to hide important evidence.

- Cooldown begins after `spoken`, not after `session.started`, `silent`, or
  `failed`.
- Cooldown is scoped by signal family and evidence key rather than being one
  global timer.
- P0 always bypasses cooldown.
- P1 may bypass a lower-priority cooldown when the new evidence is materially
  different.
- Duplicate evidence is suppressed using normalized semantic evidence, not
  only exact transcript text.
- While a run is in flight, pending observations are coalesced by priority and
  recency. The highest-priority useful evidence must survive.

## 9. Visible Experience

- Raw observation events and skipped decisions are diagnostic-only.
- Thinking state appears only after a wake has been claimed.
- `SILENT`, ignored, and superseded runs create no Coach card.
- A stronger new message may replace or merge with a weaker stale message.
- Manual answers are visually and behaviorally distinct from background hints.
- Late proactive output never appears after a manual answer has taken control.

## 10. Success Criteria

- A Feishu or Zoom meeting captures the intended audio source before Coach is
  judged.
- A meaningful P1 meeting event can produce a hint without user action.
- Session start cannot suppress an early meeting question or objection.
- Simultaneous Wake and Enter produce one user-priority answer.
- Cancellation prevents stale proactive results from writing to UI.
- Ordinary discussion can be observed without producing visible noise.
- One replay trace explains every outcome as ignored, spoken, silent, failed,
  or superseded.
- Replay tests exercise the same detector and runtime used by the application.
