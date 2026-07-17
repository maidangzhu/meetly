import assert from "node:assert/strict";
import {
  createVoiceOverlayPresentationState,
  voiceOverlayPresentationReducer,
  VOICE_OVERLAY_PRESENTATION_MODES,
} from "../src/app/voiceOverlay/presentation.ts";
import { isNearScrollBottom } from "../src/app/voiceOverlay/autoScroll.ts";

assert.deepEqual(VOICE_OVERLAY_PRESENTATION_MODES, ["hidden", "compact", "expanded"]);

const compact = createVoiceOverlayPresentationState();
assert.deepEqual(compact, { mode: "compact", lastNonHidden: "compact" });

const expanded = voiceOverlayPresentationReducer(compact, { type: "expand" });
assert.deepEqual(expanded, { mode: "expanded", lastNonHidden: "expanded" });

const hiddenExpanded = voiceOverlayPresentationReducer(expanded, { type: "hide" });
assert.deepEqual(hiddenExpanded, { mode: "hidden", lastNonHidden: "expanded" });
assert.deepEqual(voiceOverlayPresentationReducer(hiddenExpanded, { type: "reopen" }), expanded);

const collapsed = voiceOverlayPresentationReducer(expanded, { type: "collapse" });
assert.deepEqual(collapsed, { mode: "compact", lastNonHidden: "compact" });
assert.deepEqual(
  voiceOverlayPresentationReducer(
    voiceOverlayPresentationReducer(collapsed, { type: "hide" }),
    { type: "reopen" }
  ),
  compact
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
