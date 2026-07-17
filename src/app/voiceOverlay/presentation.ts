export const VOICE_OVERLAY_PRESENTATION_MODES = ["hidden", "compact", "expanded"] as const;

export type VoiceOverlayPresentationMode = typeof VOICE_OVERLAY_PRESENTATION_MODES[number];

export type VoiceOverlayPresentationState = {
  mode: VoiceOverlayPresentationMode;
  lastNonHidden: Exclude<VoiceOverlayPresentationMode, "hidden">;
};

export type VoiceOverlayPresentationAction =
  | { type: "expand" }
  | { type: "collapse" }
  | { type: "hide" }
  | { type: "reopen" };

export function createVoiceOverlayPresentationState(
  initialMode: VoiceOverlayPresentationMode = "compact"
): VoiceOverlayPresentationState {
  return {
    mode: initialMode,
    lastNonHidden: initialMode === "expanded" ? "expanded" : "compact",
  };
}

export function voiceOverlayPresentationReducer(
  state: VoiceOverlayPresentationState,
  action: VoiceOverlayPresentationAction
): VoiceOverlayPresentationState {
  switch (action.type) {
    case "expand":
      return { mode: "expanded", lastNonHidden: "expanded" };
    case "collapse":
      return { mode: "compact", lastNonHidden: "compact" };
    case "hide":
      return { ...state, mode: "hidden" };
    case "reopen":
      return { ...state, mode: state.lastNonHidden };
  }
}
