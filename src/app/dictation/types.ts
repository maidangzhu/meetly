export type DictationActivationMode = "toggle";

export type DictationSettings = {
  enabled: boolean;
  shortcut: string;
  fallbackShortcut: string;
  activationMode: DictationActivationMode;
  aiPolishEnabled: boolean;
  autoPasteEnabled: boolean;
  keepResultInClipboard: boolean;
};

export type DictationPhase =
  | "idle"
  | "opening_microphone"
  | "recording"
  | "transcribing"
  | "polishing"
  | "pasting"
  | "completed"
  | "copied"
  | "cancelled"
  | "error"
  | "blocked";

export type DictationViewState = {
  runId: string | null;
  phase: DictationPhase;
  message: string | null;
  rawText: string | null;
  finalText: string | null;
};

export type DictationShortcutPressed = {
  runId: string;
  startedAt: number;
};

export type DictationShortcutReleased = {
  runId: string;
  releasedAt: number;
};

export type DictationBlocked = {
  reason: string;
  message: string;
};

export type DictationOutputResult = {
  pasted: boolean;
  copied: boolean;
  message: string;
};

export type DictationStatus = {
  settings: DictationSettings;
  active: boolean;
  accessibilityGranted: boolean;
  microphonePermission: "authorized" | "not_determined" | "denied" | "restricted" | "unknown";
  shortcutBackend: string;
  shortcutError: string | null;
};

export const DEFAULT_DICTATION_SETTINGS: DictationSettings = {
  enabled: true,
  shortcut: "Fn+Space",
  fallbackShortcut: "Alt+Space",
  activationMode: "toggle",
  aiPolishEnabled: true,
  autoPasteEnabled: true,
  keepResultInClipboard: true,
};
