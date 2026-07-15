import type { AssistantSuggestion } from "../types";
import type {
  VoiceAskActivePhase,
  VoiceAskConversationState,
  VoiceAskViewState,
} from "./types";

export const INITIAL_VOICE_ASK_STATE: VoiceAskConversationState = {
  conversationId: null,
  turns: [],
  activeTurn: null,
  error: null,
  terminalPhase: null,
};

export type VoiceAskAction =
  | { type: "start"; runId: string; startedAt: number }
  | { type: "phase"; runId: string; phase: VoiceAskActivePhase; message?: string | null }
  | { type: "question"; runId: string; question: string }
  | { type: "answered"; runId: string; suggestion: AssistantSuggestion; createdAt: number }
  | { type: "failed"; runId: string; message: string }
  | { type: "cancelled"; runId: string }
  | { type: "reset" };

export function voiceAskReducer(
  state: VoiceAskConversationState,
  action: VoiceAskAction
): VoiceAskConversationState {
  if (action.type === "start") {
    if (state.activeTurn) return state;
    return {
      ...state,
      conversationId: state.conversationId ?? action.runId,
      activeTurn: {
        runId: action.runId,
        phase: "opening_microphone",
        message: "正在打开麦克风",
        question: null,
        startedAt: action.startedAt,
      },
      error: null,
      terminalPhase: null,
    };
  }

  if (action.type === "reset") {
    return INITIAL_VOICE_ASK_STATE;
  }

  if (!state.activeTurn || !("runId" in action) || action.runId !== state.activeTurn.runId) {
    return state;
  }

  switch (action.type) {
    case "phase":
      return {
        ...state,
        activeTurn: {
          ...state.activeTurn,
          phase: action.phase,
          message: action.message ?? state.activeTurn.message,
        },
      };
    case "question":
      return {
        ...state,
        activeTurn: { ...state.activeTurn, question: action.question },
      };
    case "answered": {
      const question = state.activeTurn.question?.trim();
      if (!question) return state;
      return {
        ...state,
        turns: [
          ...state.turns,
          {
            id: action.runId,
            runId: action.runId,
            question,
            suggestion: action.suggestion,
            createdAt: action.createdAt,
          },
        ],
        activeTurn: null,
        error: null,
        terminalPhase: null,
      };
    }
    case "failed":
      return {
        ...state,
        activeTurn: null,
        error: {
          runId: action.runId,
          message: action.message,
          question: state.activeTurn.question,
        },
        terminalPhase: null,
      };
    case "cancelled":
      return {
        ...state,
        activeTurn: null,
        error: null,
        terminalPhase: state.turns.length > 0 ? null : "cancelled",
      };
    default:
      return state;
  }
}

export function selectVoiceAskViewState(state: VoiceAskConversationState): VoiceAskViewState {
  const latestTurn = state.turns[state.turns.length - 1] ?? null;
  const activeTurn = state.activeTurn;

  if (activeTurn) {
    return {
      runId: activeTurn.runId,
      phase: activeTurn.phase,
      message: activeTurn.message,
      question: activeTurn.question ?? latestTurn?.question ?? null,
      suggestion: latestTurn?.suggestion ?? null,
    };
  }

  if (state.error) {
    return {
      runId: state.error.runId,
      phase: "error",
      message: state.error.message,
      question: state.error.question ?? latestTurn?.question ?? null,
      suggestion: latestTurn?.suggestion ?? null,
    };
  }

  if (latestTurn) {
    return {
      runId: latestTurn.runId,
      phase: "answered",
      message: null,
      question: latestTurn.question,
      suggestion: latestTurn.suggestion,
    };
  }

  if (state.terminalPhase === "cancelled") {
    return {
      runId: null,
      phase: "cancelled",
      message: "已取消",
      question: null,
      suggestion: null,
    };
  }

  return {
    runId: null,
    phase: "idle",
    message: null,
    question: null,
    suggestion: null,
  };
}
