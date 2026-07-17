import assert from "node:assert/strict";
import { AgentRuntime, ContextStore, createSttSignalWake } from "../src/runtime/agent/index.ts";
import type { AssistantSuggestion } from "../src/app/types.ts";

Object.defineProperty(globalThis, "window", {
  configurable: true,
  value: globalThis,
});

const answer: AssistantSuggestion = {
  answer: "coach answer",
  bullets: [],
  clarifyingQuestion: null,
};

let firstResolve: ((value: AssistantSuggestion) => void) | null = null;
let calls = 0;
const messages: string[] = [];
const skipped: string[] = [];

const runtime = new AgentRuntime(
  new ContextStore(),
  {
    complete: async () => {
      calls += 1;
      if (calls === 1) {
        return new Promise<AssistantSuggestion>((resolve) => {
          firstResolve = resolve;
        });
      }
      return answer;
    },
  },
  {
    onMessage: (suggestion) => messages.push(suggestion.answer),
    onError: (message) => assert.fail(message),
    onWakeSkipped: (_wake, reason) => skipped.push(reason),
  }
);

runtime.wake(createSttSignalWake("a proactive signal", "test_signal"));
await nextTurn();
assert.equal(calls, 1);

runtime.beginManualAsk();
firstResolve?.(answer);
await nextTurn();
assert.deepEqual(messages, []);
assert.ok(skipped.includes("superseded_by_manual_ask"));

runtime.wake(createSttSignalWake("ignored while meeting Ask is active", "test_signal"));
assert.ok(skipped.includes("manual_ask_active"));

runtime.finishManualAsk();
runtime.wake(createSttSignalWake("accepted after meeting Ask completes", "test_signal"));
await nextTurn();
assert.deepEqual(messages, ["coach answer"]);

let isolatedCoachResolve: ((value: AssistantSuggestion) => void) | null = null;
const isolatedCoachMessages: string[] = [];
const isolatedCoachRuntime = new AgentRuntime(
  new ContextStore(),
  {
    complete: () => new Promise<AssistantSuggestion>((resolve) => {
      isolatedCoachResolve = resolve;
    }),
  },
  {
    onMessage: (suggestion) => isolatedCoachMessages.push(suggestion.answer),
    onError: (message) => assert.fail(message),
  }
);

isolatedCoachRuntime.wake(createSttSignalWake("coach continues during independent Fn work", "test_signal"));
await nextTurn();
const independentFnRun = Promise.resolve("fn answer");
assert.equal(await independentFnRun, "fn answer");
isolatedCoachResolve?.(answer);
await nextTurn();
assert.deepEqual(isolatedCoachMessages, ["coach answer"]);

console.log("meeting Ask / Coach wake race tests passed");

async function nextTurn() {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}
