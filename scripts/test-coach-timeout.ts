import assert from "node:assert/strict";
import { runWithOneTimeoutRetry } from "../src/runtime/agent/transport";

let retryCount = 0;
let attemptCount = 0;
const recovered = await runWithOneTimeoutRetry(
  async () => {
    attemptCount += 1;
    if (attemptCount === 1) {
      await new Promise((resolve) => setTimeout(resolve, 40));
      return "late";
    }
    return "recovered";
  },
  10,
  () => {
    retryCount += 1;
  }
);

assert.equal(recovered, "recovered");
assert.equal(attemptCount, 2);
assert.equal(retryCount, 1);

let failedAttempts = 0;
await assert.rejects(
  runWithOneTimeoutRetry(
    async () => {
      failedAttempts += 1;
      await new Promise((resolve) => setTimeout(resolve, 30));
      return "late";
    },
    5
  ),
  /连续两次超过 0 秒/
);
assert.equal(failedAttempts, 2);

console.log("coach timeout retry checks passed");
