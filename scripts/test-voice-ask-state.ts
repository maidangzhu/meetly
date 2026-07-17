import assert from "node:assert/strict";
import {
  INITIAL_VOICE_ASK_STATE,
  selectVoiceAskViewState,
  voiceAskReducer,
} from "../src/app/voiceAsk/voiceAskReducer";
import { isMeaningfulVoiceQuestion } from "../src/app/voiceAsk/question";

const firstStarted = voiceAskReducer(INITIAL_VOICE_ASK_STATE, {
  type: "start",
  runId: "voice-1",
  startedAt: 100,
  context: {
    selectedText: "A selected paragraph",
    sourceApp: "TextEdit",
    capturedAt: 90,
  },
});
assert.equal(firstStarted.conversationId, "voice-1");
assert.equal(firstStarted.context?.selectedText, "A selected paragraph");
assert.equal(firstStarted.activeTurn?.phase, "opening_microphone");
assert.equal(selectVoiceAskViewState(firstStarted).phase, "opening_microphone");

const lateContextStarted = voiceAskReducer(INITIAL_VOICE_ASK_STATE, {
  type: "start",
  runId: "voice-late-context",
  startedAt: 100,
  context: null,
});
const lateContextCaptured = voiceAskReducer(lateContextStarted, {
  type: "context",
  runId: "voice-late-context",
  context: {
    selectedText: "Captured after recording started",
    sourceApp: "TextEdit",
    capturedAt: 120,
  },
});
assert.equal(lateContextCaptured.context?.selectedText, "Captured after recording started");

const duplicateStart = voiceAskReducer(firstStarted, {
  type: "start",
  runId: "voice-duplicate",
  startedAt: 101,
  context: null,
});
assert.deepEqual(duplicateStart, firstStarted);

const firstRecording = voiceAskReducer(firstStarted, {
  type: "phase",
  runId: "voice-1",
  phase: "recording",
});
const firstQuestion = voiceAskReducer(firstRecording, {
  type: "question",
  runId: "voice-1",
  question: "What should I do?",
});
const firstAnswered = voiceAskReducer(firstQuestion, {
  type: "answered",
  runId: "voice-1",
  createdAt: 200,
  suggestion: {
    answer: "Start with the smallest reversible step.",
    bullets: ["Define the outcome"],
    clarifyingQuestion: null,
  },
});
assert.equal(firstAnswered.activeTurn, null);
assert.equal(firstAnswered.turns.length, 1);
assert.equal(selectVoiceAskViewState(firstAnswered).phase, "answered");
assert.equal(selectVoiceAskViewState(firstAnswered).suggestion?.bullets.length, 1);

const followUpStarted = voiceAskReducer(firstAnswered, {
  type: "start",
  runId: "voice-2",
  startedAt: 300,
  context: {
    selectedText: "A different selection",
    sourceApp: "Safari",
    capturedAt: 290,
  },
});
assert.equal(followUpStarted.conversationId, "voice-1");
assert.equal(followUpStarted.context?.selectedText, "A selected paragraph");
assert.equal(followUpStarted.turns.length, 1);
assert.equal(followUpStarted.activeTurn?.runId, "voice-2");

const followUpQuestion = voiceAskReducer(followUpStarted, {
  type: "question",
  runId: "voice-2",
  question: "What would that look like today?",
});
const followUpFailed = voiceAskReducer(followUpQuestion, {
  type: "failed",
  runId: "voice-2",
  message: "provider timeout",
});
assert.equal(followUpFailed.turns.length, 1);
assert.equal(followUpFailed.error?.question, "What would that look like today?");
assert.equal(selectVoiceAskViewState(followUpFailed).phase, "error");
assert.equal(selectVoiceAskViewState(followUpFailed).suggestion?.answer, firstAnswered.turns[0].suggestion.answer);

const retryStarted = voiceAskReducer(followUpFailed, {
  type: "start",
  runId: "voice-3",
  startedAt: 400,
  context: null,
});
const retryCancelled = voiceAskReducer(retryStarted, {
  type: "cancelled",
  runId: "voice-3",
});
assert.equal(retryCancelled.turns.length, 1);
assert.equal(selectVoiceAskViewState(retryCancelled).phase, "answered");

const staleFailure = voiceAskReducer(retryStarted, {
  type: "failed",
  runId: "voice-old",
  message: "stale",
});
assert.deepEqual(staleFailure, retryStarted);

const emptyCancelled = voiceAskReducer(firstStarted, {
  type: "cancelled",
  runId: "voice-1",
});
assert.equal(selectVoiceAskViewState(emptyCancelled).phase, "cancelled");

assert.deepEqual(voiceAskReducer(firstAnswered, { type: "reset" }), INITIAL_VOICE_ASK_STATE);

assert.equal(isMeaningfulVoiceQuestion("嗯。"), false);
assert.equal(isMeaningfulVoiceQuestion("Yeah."), false);
assert.equal(isMeaningfulVoiceQuestion("OK"), false);
assert.equal(isMeaningfulVoiceQuestion("今天"), false);
assert.equal(isMeaningfulVoiceQuestion("今天有什么新闻？"), true);
assert.equal(isMeaningfulVoiceQuestion("Rust"), true);

console.log("voice ask state tests passed");
