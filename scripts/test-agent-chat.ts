import assert from "node:assert/strict";
import { buildAgentChatContext, buildAgentChatHistory, resolveAgentChatMessage } from "../src/app/agentChat.ts";
import {
  MAX_DOCUMENT_CHARS,
  readDroppedContextFiles,
  summarizeContextDocuments,
} from "../src/app/contextDocuments.ts";
import type { AgentChatTurn, ContextDocument, TranscriptSegment } from "../src/app/types.ts";

assert.equal(resolveAgentChatMessage(), "需要帮助");
assert.equal(resolveAgentChatMessage("   "), "需要帮助");
assert.equal(resolveAgentChatMessage("  复盘刚才的会议  "), "复盘刚才的会议");

const transcript: TranscriptSegment[] = [
  { id: "t1", speaker: "interviewer", text: "预算什么时候确认？", startMs: 0, endMs: 1_000 },
  { id: "t2", speaker: "user", text: "周五前。", startMs: 1_100, endMs: 2_000 },
];
const documents: ContextDocument[] = [{
  id: "d1",
  name: "合作范围.md",
  kind: "reference",
  text: "scope",
  size: 5,
  createdAt: 1,
}];
const context = buildAgentChatContext({ documents, goal: "确认负责人", transcript });
assert.match(context, /会议目标：确认负责人/);
assert.match(context, /可用资料：合作范围\.md/);
assert.match(context, /对方：预算什么时候确认？/);
assert.match(context, /我：周五前。/);

const longDocument = {
  ...documents[0],
  text: `${"a".repeat(MAX_DOCUMENT_CHARS - 1)}ZTAIL`,
};
const documentSummary = summarizeContextDocuments([longDocument]);
assert.match(documentSummary, /Z/);
assert.doesNotMatch(documentSummary, /TAIL/);

const imported = await readDroppedContextFiles([
  new File(["文".repeat(MAX_DOCUMENT_CHARS + 25)], "长资料.txt", { type: "text/plain" }),
], "candidate");
assert.equal(imported.rejected.length, 0);
assert.equal(imported.documents[0]?.text.length, MAX_DOCUMENT_CHARS);

const answered = (index: number): AgentChatTurn => ({
  id: `turn-${index}`,
  createdAt: index,
  question: `question ${index}`,
  suggestion: { answer: `answer ${index}`, bullets: [], clarifyingQuestion: null },
  error: null,
  toolTraces: [],
});
const history = buildAgentChatHistory([
  answered(1),
  { ...answered(2), suggestion: null },
  ...Array.from({ length: 7 }, (_, index) => answered(index + 3)),
]);
assert.equal(history.length, 6);
assert.equal(history[0]?.question, "question 4");
assert.equal(history[5]?.suggestion.answer, "answer 9");

console.log("agent chat context and history tests passed");
