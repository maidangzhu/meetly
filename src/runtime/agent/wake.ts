export type WakeKind = "enter" | "stt_question";

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

export function createSttQuestionWake(text: string): WakeEvent {
  return {
    kind: "stt_question",
    priority: 90,
    reason: "stt_question_detected",
    evidence: [text],
    createdAtMs: Date.now(),
  };
}
