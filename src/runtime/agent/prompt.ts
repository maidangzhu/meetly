import type { ContextSnapshot } from "./contextStore";
import type { WakeEvent } from "./wake";
import { summarizeContextDocuments } from "../../app/contextDocuments";

export type AgentPrompt = {
  wake: WakeEvent;
  snapshot: ContextSnapshot;
  text: string;
};

export function buildAgentPrompt(wake: WakeEvent, snapshot: ContextSnapshot): AgentPrompt {
  const recent = snapshot.recentTranscript
    .map((segment) => segment.text.trim())
    .filter(Boolean)
    .join("\n");

  const documents = summarizeContextDocuments(snapshot.documents);
  const roleInstruction =
    snapshot.perspective === "interviewer"
      ? "The user is the interviewer. Help them fairly evaluate the candidate, ask sharper follow-up questions, and connect the discussion to the candidate's resume. Do not trick or embarrass the candidate."
      : "The user is the candidate. Help them answer in their own voice, using their resume/background when it is relevant.";

  return {
    wake,
    snapshot,
    text: [
      `Wake kind: ${wake.kind}`,
      `Wake reason: ${wake.reason}`,
      `User perspective: ${snapshot.perspective}`,
      "",
      roleInstruction,
      "",
      "Available tools:",
      "- read_file: read uploaded resume or meeting/reference material by file id or query.",
      "- web_fetch: fetch current external information with Exa when the conversation mentions a company, market, product, or unfamiliar domain.",
      "",
      "Uploaded documents:",
      documents || "(none)",
      "",
      "Recent transcript:",
      recent || "(none)",
      "",
      "You are the right-side realtime coach. Return one concise coach message the user can use next.",
      "If this is session_start and documents exist, call read_file first to understand the resume/reference material before speaking.",
      "If the user asks what a workflow/project/product/company is, or the transcript mentions an unfamiliar company, previous employer, product, market, customer, or industry, use read_file and web_fetch before giving advice.",
      "For interviewer perspective, use resume plus external company/product context to suggest fair follow-up questions, evidence checks, and evaluation angles. Do not design trick questions.",
      "When using tools, your final message should include a short visible evidence summary, for example: 判断依据：... 建议：...",
      "The evidence summary must be a user-facing summary, not hidden step-by-step chain-of-thought.",
      "Do not return SILENT. Do not say you detected a question. Do not write long analysis.",
      "Prefer one directly usable sentence or a compact next-step skeleton.",
    ].join("\n"),
  };
}
