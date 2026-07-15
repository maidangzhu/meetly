import type { DictationPhase, DictationViewState } from "./types";

export const INITIAL_DICTATION_STATE: DictationViewState = {
  runId: null,
  phase: "idle",
  message: null,
  rawText: null,
  finalText: null,
};

export type DictationAction =
  | { type: "start"; runId: string }
  | { type: "phase"; runId: string; phase: DictationPhase; message?: string | null }
  | { type: "transcribed"; runId: string; rawText: string }
  | { type: "finished"; runId: string; phase: "completed" | "copied"; finalText: string; message: string }
  | { type: "paste_failed"; runId: string; finalText: string; message: string }
  | { type: "failed"; runId: string; message: string }
  | { type: "cancelled"; runId: string }
  | { type: "blocked"; message: string }
  | { type: "reset"; runId?: string };

export function dictationReducer(
  state: DictationViewState,
  action: DictationAction
): DictationViewState {
  if (action.type === "start") {
    if (isActivePhase(state.phase)) {
      return state;
    }
    return {
      runId: action.runId,
      phase: "opening_microphone",
      message: "正在打开麦克风",
      rawText: null,
      finalText: null,
    };
  }

  if (action.type === "blocked") {
    return {
      ...INITIAL_DICTATION_STATE,
      phase: "blocked",
      message: action.message,
    };
  }

  if (action.type === "reset") {
    if (action.runId && state.runId && state.runId !== action.runId) {
      return state;
    }
    return INITIAL_DICTATION_STATE;
  }

  if (!state.runId || !("runId" in action) || action.runId !== state.runId) {
    return state;
  }

  switch (action.type) {
    case "phase":
      return { ...state, phase: action.phase, message: action.message ?? state.message };
    case "transcribed":
      return { ...state, rawText: action.rawText };
    case "finished":
      return {
        ...state,
        phase: action.phase,
        finalText: action.finalText,
        message: action.message,
      };
    case "paste_failed":
      return {
        ...state,
        phase: "paste_failed",
        finalText: action.finalText,
        message: action.message,
      };
    case "failed":
      return { ...state, phase: "error", message: action.message };
    case "cancelled":
      return { ...state, phase: "cancelled", message: "已取消" };
    default:
      return state;
  }
}
export function isActivePhase(phase: DictationPhase) {
  return [
    "opening_microphone",
    "recording",
    "transcribing",
    "polishing",
    "pasting",
  ].includes(phase);
}
