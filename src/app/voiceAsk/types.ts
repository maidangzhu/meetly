import type { AssistantSuggestion } from "../types";

export type VoiceAskPhase =
  | "idle"
  | "opening_microphone"
  | "recording"
  | "transcribing"
  | "thinking"
  | "answered"
  | "cancelled"
  | "error";

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
