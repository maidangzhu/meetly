# Proposal: stabilize-interview-assist-p0

## Why

Meetly is now prioritizing interview assistance before meeting notes or a
general office agent. The current microphone path proves the core loop can
work, but it is still too fragile for live interviews:

- transcript state is still loosely held in the React component;
- Ask can miss the current in-progress audio segment unless it is flushed;
- STT results can return out of order;
- fixed-duration chunks can cut questions at segment boundaries;
- prompts can be pulled toward older transcript unless the latest question is
  explicitly elevated;
- the product lacks a clear interview session boundary.

P0 should make the manual interview assist loop reliable before adding
proactive behavior.

## What

- Define an explicit interview session lifecycle in the app:
  - start interview;
  - append transcript segments;
  - Ask within current interview;
  - stop interview.
- Keep microphone capture as the P0 input path.
- Keep listening and transcription running while Ask is in flight.
- Flush the current in-progress microphone segment before Ask so the latest
  spoken question is included.
- Keep transcript ordered by capture time, not by STT response completion time.
- Build Ask context with:
  - the latest detected/question-like transcript as the highest-priority block;
  - recent transcript as primary context;
  - full session transcript as background context while token budget permits.
- Add chunk overlap or equivalent boundary protection so questions split
  across segment boundaries are less likely to be lost.
- Add local debug logging for session, audio chunk, STT, context assembly, and
  Ask events.

## Non-goals

- No automatic suggestions without user action. That belongs to
  `add-interview-auto-assist-p1`.
- No streaming STT provider migration in this change.
- No speaker diarization implementation in this change, though the data model
  should leave room for speaker labels later.
- No persisted long-term memory or session database in this change.
- No screen context or web search in this change.

