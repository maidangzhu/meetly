import assert from "node:assert/strict";
import {
  dictationReducer,
  INITIAL_DICTATION_STATE,
} from "../src/app/dictation/dictationReducer";
import {
  chooseDictationOutput,
  classifyDictationDelivery,
} from "../src/app/dictation/output";
import { DEFAULT_DICTATION_SETTINGS } from "../src/app/dictation/types";

assert.equal(DEFAULT_DICTATION_SETTINGS.activationMode, "toggle");
assert.equal(chooseDictationOutput("raw transcript", "polished transcript"), "polished transcript");
assert.equal(chooseDictationOutput("raw transcript", "   "), "raw transcript");
assert.equal(chooseDictationOutput("raw transcript"), "raw transcript");
assert.equal(
  classifyDictationDelivery({ outcome: "pasted" }),
  "completed"
);
const autoPasteCopiedFallback = { outcome: "copied" as const, retryable: true };
assert.equal(classifyDictationDelivery(autoPasteCopiedFallback), "copied");
assert.equal(
  classifyDictationDelivery({ outcome: "failed" }),
  "delivery_failed"
);

const started = dictationReducer(INITIAL_DICTATION_STATE, { type: "start", runId: "run-1" });
assert.equal(started.phase, "opening_microphone");

const recording = dictationReducer(started, {
  type: "phase",
  runId: "run-1",
  phase: "recording",
});
assert.equal(recording.phase, "recording");

const duplicate = dictationReducer(recording, { type: "start", runId: "run-2" });
assert.equal(duplicate.runId, "run-1");

const stale = dictationReducer(recording, {
  type: "failed",
  runId: "run-old",
  message: "stale",
});
assert.deepEqual(stale, recording);

const copied = dictationReducer(recording, {
  type: "finished",
  runId: "run-1",
  phase: "copied",
  finalText: "hello",
  message: "copied",
  retryable: true,
});
assert.equal(copied.phase, "copied");
assert.equal(copied.finalText, "hello");
assert.equal(copied.deliveryRetryable, true);

const pasteFailed = dictationReducer(recording, {
  type: "delivery_failed",
  runId: "run-1",
  finalText: "hello",
  message: "paste failed",
  retryable: true,
});
assert.equal(pasteFailed.phase, "delivery_failed");
assert.equal(pasteFailed.finalText, "hello");
assert.equal(pasteFailed.message, "paste failed");
assert.equal(pasteFailed.deliveryRetryable, true);

const reset = dictationReducer(pasteFailed, { type: "reset", runId: "run-1" });
assert.deepEqual(reset, INITIAL_DICTATION_STATE);

console.log("dictation state tests passed");
