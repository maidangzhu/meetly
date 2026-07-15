import assert from "node:assert/strict";
import {
  dictationReducer,
  INITIAL_DICTATION_STATE,
} from "../src/app/dictation/dictationReducer";
import { chooseDictationOutput } from "../src/app/dictation/output";
import { DEFAULT_DICTATION_SETTINGS } from "../src/app/dictation/types";
import {
  INITIAL_VOICE_ASK_STATE,
  voiceAskReducer,
} from "../src/app/voiceAsk/voiceAskReducer";

assert.equal(DEFAULT_DICTATION_SETTINGS.activationMode, "toggle");
assert.equal(chooseDictationOutput("raw transcript", "polished transcript"), "polished transcript");
assert.equal(chooseDictationOutput("raw transcript", "   "), "raw transcript");
assert.equal(chooseDictationOutput("raw transcript"), "raw transcript");

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
});
assert.equal(copied.phase, "copied");
assert.equal(copied.finalText, "hello");

const pasteFailed = dictationReducer(recording, {
  type: "paste_failed",
  runId: "run-1",
  finalText: "hello",
  message: "paste failed",
});
assert.equal(pasteFailed.phase, "paste_failed");
assert.equal(pasteFailed.finalText, "hello");
assert.equal(pasteFailed.message, "paste failed");

const reset = dictationReducer(pasteFailed, { type: "reset", runId: "run-1" });
assert.deepEqual(reset, INITIAL_DICTATION_STATE);

const voiceStarted = voiceAskReducer(INITIAL_VOICE_ASK_STATE, {
  type: "start",
  runId: "voice-1",
});
assert.equal(voiceStarted.phase, "opening_microphone");

const voiceRecording = voiceAskReducer(voiceStarted, {
  type: "phase",
  runId: "voice-1",
  phase: "recording",
});
assert.equal(voiceRecording.phase, "recording");

const withQuestion = voiceAskReducer(voiceRecording, {
  type: "question",
  runId: "voice-1",
  question: "What should I do?",
});
assert.equal(withQuestion.question, "What should I do?");

const answered = voiceAskReducer(withQuestion, {
  type: "answered",
  runId: "voice-1",
  suggestion: {
    answer: "Start with the smallest reversible step.",
    bullets: ["Define the outcome"],
    clarifyingQuestion: null,
  },
});
assert.equal(answered.phase, "answered");
assert.equal(answered.suggestion?.bullets.length, 1);

const staleVoiceAnswer = voiceAskReducer(answered, {
  type: "failed",
  runId: "voice-old",
  message: "stale",
});
assert.deepEqual(staleVoiceAnswer, answered);

assert.deepEqual(voiceAskReducer(answered, { type: "reset" }), INITIAL_VOICE_ASK_STATE);

console.log("dictation state tests passed");
