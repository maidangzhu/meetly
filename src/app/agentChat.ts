import type { AgentChatTurn, ContextDocument, TranscriptSegment } from "./types";

export function resolveAgentChatMessage(message?: string) {
  return message?.trim() || "需要帮助";
}

export function buildAgentChatContext(input: {
  documents: ContextDocument[];
  goal: string;
  transcript: TranscriptSegment[];
}) {
  const transcript = input.transcript
    .slice(-80)
    .map((segment) => `${segment.speaker === "user" ? "我" : "对方"}：${segment.text.trim()}`)
    .filter((line) => !line.endsWith("："))
    .join("\n");
  const documents = input.documents.map((document) => document.name).join("、");

  return [
    input.goal.trim() ? `会议目标：${input.goal.trim()}` : null,
    documents ? `可用资料：${documents}` : null,
    transcript ? `会议转录：\n${transcript}` : null,
  ].filter(Boolean).join("\n\n").slice(-12_000);
}

export function buildAgentChatHistory(turns: AgentChatTurn[], limit = 6) {
  return turns
    .filter((turn) => turn.suggestion)
    .slice(-limit)
    .map((turn) => ({
      question: turn.question,
      suggestion: turn.suggestion!,
    }));
}
