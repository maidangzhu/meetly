export type WakeKind = "enter" | "session_start" | "stt_question" | "stt_signal";

export type WakeEvent = {
  id: string;
  kind: WakeKind;
  priority: number;
  reason: string;
  evidence: string[];
  evidenceEventIds: string[];
  sessionId?: string;
  createdAtMs: number;
};

export function createEnterWake(): WakeEvent {
  return {
    id: createWakeId(),
    kind: "enter",
    priority: 100,
    reason: "user_frontend_ask",
    evidence: [],
    evidenceEventIds: [],
    createdAtMs: Date.now(),
  };
}

export function createSessionStartWake(hasDocuments: boolean): WakeEvent {
  return {
    id: createWakeId(),
    kind: "session_start",
    priority: hasDocuments ? 95 : 70,
    reason: hasDocuments ? "session_started_with_documents" : "session_started",
    evidence: hasDocuments ? ["session started; uploaded documents are available"] : ["session started"],
    evidenceEventIds: [],
    createdAtMs: Date.now(),
  };
}

export function createSttQuestionWake(text: string): WakeEvent {
  return {
    id: createWakeId(),
    kind: "stt_question",
    priority: 90,
    reason: "stt_question_detected",
    evidence: [text],
    evidenceEventIds: [],
    createdAtMs: Date.now(),
  };
}

export function createSttSignalWake(text: string, reason: string): WakeEvent {
  return {
    id: createWakeId(),
    kind: "stt_signal",
    priority: 65,
    reason,
    evidence: [text],
    evidenceEventIds: [],
    createdAtMs: Date.now(),
  };
}

function createWakeId() {
  return `wake-${Date.now().toString(16)}-${Math.random().toString(16).slice(2, 8)}`;
}
