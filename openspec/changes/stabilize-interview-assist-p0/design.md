# Design: stabilize-interview-assist-p0

## 1. Core Decision

P0 is still a manual assist product:

> The user starts an interview session, Meetly listens continuously, and Ask
> produces a response only when the user presses Enter or clicks Ask.

This change should not introduce proactive UI or autonomous agent behavior.
It should make the current manual path reliable enough to support that later.

## 2. Session Model

Introduce a frontend-domain session model even if it is still stored in
memory:

```ts
type InterviewSession = {
  id: string;
  startedAt: number;
  endedAt: number | null;
  status: "idle" | "listening" | "asking" | "error";
  transcript: TranscriptSegment[];
  asks: AskTurn[];
};

type TranscriptSegment = {
  id: string;
  source: "microphone";
  text: string;
  startMs: number;
  endMs: number;
  speaker?: "interviewer" | "user" | "unknown";
};

type AskTurn = {
  id: string;
  createdAt: number;
  latestQuestion: string;
  contextPreview: string;
  answer: string | null;
  error: string | null;
};
```

The first implementation can live in React state/refs, but the API boundary
should be shaped so it can move to a store or SQLite later.

## 3. Audio Chunking

P0 keeps MediaRecorder-based microphone capture because it is already working
on macOS and triggers the expected privacy indicator.

The current fixed chunking should be hardened:

- record complete WebM/OGG blobs, not raw timeslice fragments;
- stop and restart chunks periodically;
- on Ask, stop the current recorder immediately and wait for its STT result;
- store `startMs` and `endMs` from capture time before STT begins;
- insert returned transcript by `endMs`, not by response arrival order.

### Overlap

Chunk overlap reduces boundary loss when a question crosses a cut point.

Recommended P0 behavior:

- segment duration: 5 seconds;
- overlap target: 0.5-1.0 second;
- dedupe near-duplicate transcript text before adding to visible transcript.

If MediaRecorder restart overlap is awkward, an acceptable P0 fallback is:

- shorter segment duration;
- Ask flush;
- duplicate-text suppression.

True sample-level overlap can wait until a lower-level audio buffer is added.

## 4. Context Assembly

Ask context should not be a plain concatenation where older transcript has the
same weight as the latest question.

Build the user message in ordered sections:

```text
Latest question or latest transcript:
...

Recent transcript:
...

Full session transcript:
...
```

Rules:

- latest block is always included when available;
- recent block covers approximately the last 60-120 seconds;
- full session transcript can be included while it remains small;
- if transcript grows beyond budget, summarize or truncate older content;
- logs should include metadata and short previews, not credentials.

The user asked to include all transcript for now. That is acceptable for P0 as
long as the latest block is still explicitly elevated.

## 5. Latest Question Detection

P0 can use a deterministic heuristic rather than a model:

- question mark or Chinese question particles;
- English question starters;
- interview prompts such as "tell me about", "walk me through", "explain",
  "how would you", "what do you think";
- fallback to latest transcript segment if no clear question is detected.

The detector should return:

```ts
type LatestQuestionCandidate = {
  text: string;
  confidence: number;
  reason: string;
};
```

P0 uses this for context ordering, not for automatic UI.

## 6. Debug Logging

Continue writing to `~/.meetly/debug.log`.

Log these events:

- session start/stop;
- segment start/stop;
- STT request start/finish;
- transcript insert with capture timestamps;
- Ask flush start/finish;
- latest question selected;
- context lengths and head/tail previews;
- LLM request success/error.

Never log API keys or full Authorization headers.

## 7. Future Compatibility

This P0 shape should leave room for:

- VAD endpointing;
- streaming STT partials;
- diarization;
- automatic question detection;
- answer prefetch cache;
- persisted session memory.

