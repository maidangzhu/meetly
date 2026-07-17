import assert from "node:assert/strict";
import { isLikelyDuplicateTranscript } from "../src/app/interviewLogic.ts";
import { resolveAudioSourceForSessionChange } from "../src/app/sessionAudio.ts";

assert.equal(resolveAudioSourceForSessionChange("remote", "microphone"), "system");
assert.equal(resolveAudioSourceForSessionChange("remote", "system"), "system");
assert.equal(resolveAudioSourceForSessionChange("in_person", "microphone"), "microphone");
assert.equal(resolveAudioSourceForSessionChange("in_person", "system"), "microphone");

const systemSegment = {
  id: "system-1",
  source: "system" as const,
  speaker: "interviewer" as const,
  text: "我们下周开始",
  startMs: 0,
  endMs: 1_000,
};
assert.equal(
  isLikelyDuplicateTranscript(
    {
      ...systemSegment,
      id: "microphone-1",
      source: "microphone",
      speaker: "user",
      startMs: 1_050,
      endMs: 2_000,
    },
    [systemSegment]
  ),
  false,
  "the same phrase from different channels must remain in the merged conversation"
);

console.log("session audio defaults checks passed");
