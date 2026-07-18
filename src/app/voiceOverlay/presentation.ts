export const VOICE_OVERLAY_PRESENTATION_MODES = ["hidden", "compact", "expanded"] as const;

export type VoiceOverlayPresentationMode = typeof VOICE_OVERLAY_PRESENTATION_MODES[number];

export type VoiceOverlayPresentationState = {
  mode: VoiceOverlayPresentationMode;
};

export type VoiceOverlayPresentationAction =
  | { type: "expand" }
  | { type: "collapse" }
  | { type: "hide" }
  | { type: "begin_run" };

export function createVoiceOverlayPresentationState(
  initialMode: VoiceOverlayPresentationMode = "compact"
): VoiceOverlayPresentationState {
  return { mode: initialMode };
}

export function voiceOverlayPresentationReducer(
  state: VoiceOverlayPresentationState,
  action: VoiceOverlayPresentationAction
): VoiceOverlayPresentationState {
  switch (action.type) {
    case "expand":
      return { mode: "expanded" };
    case "collapse":
      return { mode: "compact" };
    case "hide":
      return { mode: "hidden" };
    case "begin_run":
      return state.mode === "hidden" ? { mode: "compact" } : state;
  }
}
