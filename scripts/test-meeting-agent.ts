import assert from "node:assert/strict";
import { ContextStore } from "../src/runtime/agent/contextStore";
import { detectSttWake } from "../src/runtime/agent/demand";
import { buildAgentPrompt } from "../src/runtime/agent/prompt";
import { createSttSignalWake } from "../src/runtime/agent/wake";
import type { TranscriptSegment } from "../src/app/types";

const commercialSegment: TranscriptSegment = {
  id: "meeting-commercial",
  source: "microphone",
  speaker: "unknown",
  text: "这个报价可以接受，但是交付范围需要再确认。",
  startMs: 0,
  endMs: 2_000,
};

const meetingWake = detectSttWake(commercialSegment, "meeting");
assert.equal(meetingWake?.kind, "stt_signal");
assert.equal(meetingWake?.reason, "meeting_commercial_terms");
assert.equal(detectSttWake(commercialSegment, "interview"), null);

const store = new ContextStore();
store.setSessionConfig({
  kind: "meeting",
  audioSource: "microphone",
  goal: "确认合作范围，争取本周启动",
});
store.pushTranscript(commercialSegment);

const prompt = buildAgentPrompt(
  createSttSignalWake(commercialSegment.text, "meeting_commercial_terms"),
  store.snapshot(120_000)
).text;

assert.match(prompt, /确认合作范围，争取本周启动/);
assert.match(prompt, /proactive side coach/i);
assert.match(prompt, /Audio source: microphone/);

console.log("meeting agent checks passed");
