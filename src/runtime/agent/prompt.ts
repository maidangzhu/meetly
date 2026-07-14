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
  const roleInstruction = snapshot.sessionKind === "meeting"
    ? [
        "The user is in a live meeting or negotiation. Act as a proactive side coach.",
        `Primary objective: ${snapshot.goal || "help the user reach a clear, useful outcome without overcommitting"}.`,
        "Track objections, commitments, price, timeline, scope, ownership, concessions, decisions, and next steps.",
        "When a key moment appears, tell the user what to do next and give exact words when useful.",
      ].join(" ")
    : snapshot.perspective === "interviewer"
      ? "The user is the interviewer. Help them fairly evaluate the candidate, ask sharper follow-up questions, and connect the discussion to the candidate's resume. Do not trick or embarrass the candidate."
      : "The user is the candidate. Help them answer in their own voice, using their resume/background when it is relevant.";

  return {
    wake,
    snapshot,
    text: [
      `Wake kind: ${wake.kind}`,
      `Wake reason: ${wake.reason}`,
      `Session kind: ${snapshot.sessionKind}`,
      `Audio source: ${snapshot.audioSource}`,
      `User perspective: ${snapshot.perspective}`,
      "",
      roleInstruction,
      "",
      "Uploaded reference material:",
      documents || "(none)",
      "",
      "Recent transcript:",
      recent || "(none)",
      "",
      "You are the right-side realtime coach. Return one concise coach message the user can use next.",
      "For a meeting, be proactive around the stated objective. Prioritize risks, leverage, unresolved terms, useful follow-ups, and closing the next step. Do not wait for an explicit question.",
      "For a meeting, format the response as one short action followed by an optional directly usable sentence. Never produce a meeting summary while the conversation is still live.",
      "For interviewer perspective, use resume plus external company/product context to suggest fair follow-up questions, evidence checks, and evaluation angles. Do not design trick questions.",
      "Do not return SILENT. Do not say you detected a question. Do not write long analysis.",
      "Prefer one directly usable sentence or a compact next-step skeleton.",
    ].join("\n"),
  };
}
