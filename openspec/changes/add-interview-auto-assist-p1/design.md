# Design: add-interview-auto-assist-p1

## 1. Core Decision

P1 should feel helpful but not noisy.

The default automatic behavior is:

> Detect likely interviewer questions, show a small hint, and optionally
> prepare an answer in the background. The user still chooses when to reveal
> the answer.

This matches the safer parts of the reference projects:

- Glass periodically analyzes live transcript and shows summaries/actions.
- Natively detects transcript triggers and emits dynamic action cards.
- Natively also has speculative prefetch on high-confidence question partials,
  but it avoids treating every transcript as a visible answer.

## 2. Trigger Pipeline

For every final transcript segment:

1. Insert it into the current interview session.
2. Run `QuestionDetector`.
3. If confidence is low, do nothing.
4. If confidence is medium, show a small hint.
5. If confidence is high and prefetch is enabled, run background Ask.
6. Store the prefetched result in a short-lived cache.

The first implementation can run only on final transcript. Partial transcript
support can be added later when streaming STT exists.

## 3. Question Detector

Input:

```ts
type QuestionDetectorInput = {
  segment: TranscriptSegment;
  recentTranscript: TranscriptSegment[];
  mode: "interview";
};
```

Output:

```ts
type QuestionCandidate = {
  id: string;
  text: string;
  confidence: number;
  reason: string;
  kind: "technical" | "behavioral" | "system_design" | "product" | "general";
  createdAt: number;
};
```

Initial detector can be deterministic:

- punctuation and question particles;
- English question starters;
- interview phrase triggers:
  - "tell me about";
  - "walk me through";
  - "explain";
  - "how would you";
  - "what do you think";
  - "design a system";
  - "time complexity";
  - "tradeoff".

Later, a small LLM or classifier can improve this.

## 4. UI Behavior

The hint should live in the island center or assistant panel header.

Examples:

- `Question detected · Press Enter`
- `System design prompt · Press Enter`
- `Behavioral question · Press Enter`

Rules:

- do not expand the panel automatically in P1;
- do not replace the transcript ticker for too long;
- hint expires after 10-20 seconds;
- user can dismiss;
- a new stronger candidate can replace an older one;
- if user presses Enter, use the candidate as the Ask target.

## 5. Prefetch Cache

When a high-confidence candidate appears:

- build the same context as manual Ask;
- run an LLM request in the background;
- store result with candidate id, question text, context hash, and expiry;
- pressing Enter while cache is fresh shows cached result immediately.

Rules:

- cache expires after 20-30 seconds;
- cache is invalidated if the latest transcript diverges strongly from the
  candidate;
- only one prefetch should run at a time;
- manual Ask always wins over prefetch;
- manual Ask can cancel or supersede a prefetch.

## 6. Cooldown and Dedupe

Automatic detection must not spam.

Rules:

- minimum 8-12 seconds between visible hints unless the new candidate has much
  higher confidence;
- dedupe similar question text with Jaccard/containment similarity;
- ignore filler transcript such as "嗯", "OK", "right", "yeah";
- ignore segments below a minimum length unless they are explicit follow-ups
  like "why?" with prior context.

## 7. Observability

Log to `~/.meetly/debug.log`:

- question candidate detected;
- candidate ignored with reason;
- hint shown/expired/dismissed;
- prefetch start/success/error;
- cache hit/miss on Enter;
- cooldown/dedupe decisions.

Do not log credentials.

## 8. Future Compatibility

P1 should prepare the shape for later:

- partial transcript speculative prefetch;
- diarization-based interviewer-only detection;
- VAD endpoint events;
- memory retrieval;
- screen context;
- planner decisions beyond answer/hint.

