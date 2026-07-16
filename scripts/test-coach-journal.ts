import assert from "node:assert/strict";
import { CoachEventJournal } from "../src/runtime/agent/journal";
import type { CoachJournalEntry } from "../src/runtime/agent/protocol";

const persisted: CoachJournalEntry[] = [];
const journal = new CoachEventJournal(3, (entry) => {
  persisted.push(entry);
});

const session = journal.appendEvent({
  id: "event-session",
  occurredAtMs: 100,
  sessionId: "meeting-1",
  type: "session.started",
  source: "runtime",
  details: {
    sessionKind: "meeting",
    audioSource: "system",
    apiKey: "must-not-survive",
  },
});
const capture = journal.appendEvent({
  id: "event-capture",
  occurredAtMs: 200,
  sessionId: "meeting-1",
  type: "audio.capture.started",
  source: "system",
});
const transcript = journal.appendEvent({
  id: "event-transcript",
  occurredAtMs: 300,
  sessionId: "meeting-1",
  type: "transcript.finalized",
  source: "system",
  segmentId: "segment-1",
  evidencePreview: `line one\n${"x".repeat(300)}`,
});
const transition = journal.appendTransition({
  sessionId: "meeting-1",
  status: "running",
  reason: "stt_question_detected",
  wakeId: "wake-1",
  runId: "wake-1",
  eventIds: [transcript.id, transcript.id],
});

assert.equal(session.id, "event-session");
assert.equal(capture.id, "event-capture");
assert.equal(persisted.length, 4);
assert.equal(journal.snapshot().length, 3);
assert.equal(journal.snapshot()[0].recordType, "event");
assert.equal(journal.snapshot()[2].recordType, "transition");
assert.deepEqual(transition.eventIds, ["event-transcript"]);

const sessionEntry = persisted[0];
assert.equal(sessionEntry.recordType, "event");
if (sessionEntry.recordType === "event") {
  assert.equal(sessionEntry.event.details?.apiKey, "[REDACTED]");
}

const transcriptEntry = persisted[2];
assert.equal(transcriptEntry.recordType, "event");
if (transcriptEntry.recordType === "event") {
  assert.equal(transcriptEntry.event.evidencePreview?.includes("\n"), false);
  assert.equal(transcriptEntry.event.evidencePreview?.length, 240);
}

journal.clear();
assert.deepEqual(journal.snapshot(), []);

assert.throws(() => new CoachEventJournal(0), /positive integer/);

console.log("coach event journal checks passed");
