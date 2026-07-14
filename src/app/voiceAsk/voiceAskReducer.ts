import type { AssistantSuggestion } from "../types";
import type { VoiceAskPhase, VoiceAskViewState } from "./types";

export const INITIAL_VOICE_ASK_STATE: VoiceAskViewState = {
  runId: null,
  phase: "idle",
  message: null,
  question: null,
  suggestion: null,
};

export type VoiceAskAction =
  | { type: "start"; runId: string }
  | { type: "phase"; runId: string; phase: VoiceAskPhase; message?: string | null }
  | { type: "question"; runId: string; question: string }
  | { type: "answered"; runId: string; suggestion: AssistantSuggestion }
  | { type: "failed"; runId: string; message: string }
  | { type: "cancelled"; runId: string }
  | { type: "reset" };

export function voiceAskReducer(
  state: VoiceAskViewState,
  action: VoiceAskAction
): VoiceAskViewState {
  if (action.type === "start") {
    return {
      runId: action.runId,
      phase: "opening_microphone",
      message: "正在打开麦克风",
      question: null,
      suggestion: null,
    };
  }

  if (action.type === "reset") {
    return INITIAL_VOICE_ASK_STATE;
  }

  if (!state.runId || !("runId" in action) || action.runId !== state.runId) {
    return state;
  }

  switch (action.type) {
    case "phase":
      return { ...state, phase: action.phase, message: action.message ?? state.message };
    case "question":
      return { ...state, question: action.question };
    case "answered":
      return {
        ...state,
        phase: "answered",
        message: null,
        suggestion: action.suggestion,
      };
    case "failed":
      return { ...state, phase: "error", message: action.message };
    case "cancelled":
      return { ...state, phase: "cancelled", message: "已取消" };
    default:
      return state;
  }
}
