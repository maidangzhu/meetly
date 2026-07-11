export type WakeKind = "enter" | "session_start" | "stt_question" | "stt_signal";

export type WakeEvent = {
  kind: WakeKind;
  priority: number;
  reason: string;
  evidence: string[];
  createdAtMs: number;
};

export function createEnterWake(): WakeEvent {
  return {
    kind: "enter",
    priority: 100,
    reason: "user_frontend_ask",
    evidence: [],
    createdAtMs: Date.now(),
  };
}

export function createSessionStartWake(hasDocuments: boolean): WakeEvent {
  return {
    kind: "session_start",
    priority: hasDocuments ? 95 : 70,
    reason: hasDocuments ? "session_started_with_documents" : "session_started",
    evidence: hasDocuments ? ["session started; uploaded documents are available"] : ["session started"],
    createdAtMs: Date.now(),
  };
}

export function createSttQuestionWake(text: string): WakeEvent {
  return {
    kind: "stt_question",
    priority: 90,
    reason: "stt_question_detected",
    evidence: [text],
    createdAtMs: Date.now(),
  };
}

export function createSttSignalWake(text: string, reason: string): WakeEvent {
  return {
    kind: "stt_signal",
    priority: 65,
    reason,
    evidence: [text],
    createdAtMs: Date.now(),
  };
}
