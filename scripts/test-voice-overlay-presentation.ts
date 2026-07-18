import assert from "node:assert/strict";
import {
  createVoiceOverlayPresentationState,
  voiceOverlayPresentationReducer,
  VOICE_OVERLAY_PRESENTATION_MODES,
} from "../src/app/voiceOverlay/presentation.ts";
import { isNearScrollBottom } from "../src/app/voiceOverlay/autoScroll.ts";

assert.deepEqual(VOICE_OVERLAY_PRESENTATION_MODES, ["hidden", "compact", "expanded"]);

const compact = createVoiceOverlayPresentationState();
assert.deepEqual(compact, { mode: "compact" });

const expanded = voiceOverlayPresentationReducer(compact, { type: "expand" });
assert.deepEqual(expanded, { mode: "expanded" });

const hiddenExpanded = voiceOverlayPresentationReducer(expanded, { type: "hide" });
assert.deepEqual(hiddenExpanded, { mode: "hidden" });
assert.deepEqual(
  voiceOverlayPresentationReducer(hiddenExpanded, { type: "begin_run" }),
  compact
);

const collapsed = voiceOverlayPresentationReducer(expanded, { type: "collapse" });
assert.deepEqual(collapsed, compact);
assert.deepEqual(
  voiceOverlayPresentationReducer(compact, { type: "begin_run" }),
  compact
);
assert.deepEqual(
  voiceOverlayPresentationReducer(expanded, { type: "begin_run" }),
  expanded
);

assert.equal(
  isNearScrollBottom({ scrollHeight: 1_000, scrollTop: 560, clientHeight: 400 }),
  true
);
assert.equal(
  isNearScrollBottom({ scrollHeight: 1_000, scrollTop: 559, clientHeight: 400 }),
  false
);
assert.equal(
  isNearScrollBottom({ scrollHeight: 300, scrollTop: 0, clientHeight: 400 }),
  true
);

console.log("voice overlay presentation checks passed");
