import assert from "node:assert/strict";
import { resolveAudioSourceForSessionChange } from "../src/app/sessionAudio.ts";

assert.equal(resolveAudioSourceForSessionChange("remote", "microphone"), "system");
assert.equal(resolveAudioSourceForSessionChange("remote", "system"), "system");
assert.equal(resolveAudioSourceForSessionChange("in_person", "microphone"), "microphone");
assert.equal(resolveAudioSourceForSessionChange("in_person", "system"), "microphone");

console.log("session audio ok");
