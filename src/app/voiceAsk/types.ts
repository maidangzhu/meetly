import type { AssistantSuggestion } from "../types";

export type VoiceAskActivePhase =
  | "opening_microphone"
  | "recording"
  | "transcribing"
  | "thinking";

export type VoiceAskPhase =
  | "idle"
  | VoiceAskActivePhase
  | "answered"
  | "cancelled"
  | "error";

export type VoiceAskTurn = {
  id: string;
  runId: string;
  question: string;
  suggestion: AssistantSuggestion;
  createdAt: number;
};

export type VoiceAskActiveTurn = {
  runId: string;
  phase: VoiceAskActivePhase;
  message: string | null;
  question: string | null;
  startedAt: number;
};

export type VoiceAskConversationError = {
  runId: string;
  message: string;
  question: string | null;
};

export type VoiceAskConversationState = {
  conversationId: string | null;
  turns: VoiceAskTurn[];
  activeTurn: VoiceAskActiveTurn | null;
  error: VoiceAskConversationError | null;
  terminalPhase: "cancelled" | null;
};

// Presentation compatibility for the existing overlay. The conversation
// model is richer, but the UI can migrate independently in a later step.
export type VoiceAskViewState = {
  runId: string | null;
  phase: VoiceAskPhase;
  message: string | null;
  question: string | null;
  suggestion: AssistantSuggestion | null;
};

export type VoiceAskShortcutPressed = {
  runId: string;
  startedAt: number;
};

export type VoiceAskShortcutReleased = {
  runId: string;
  releasedAt: number;
};
