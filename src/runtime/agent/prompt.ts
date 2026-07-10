import type { ContextSnapshot } from "./contextStore";
import type { WakeEvent } from "./wake";

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

  return {
    wake,
    snapshot,
    text: [
      `Wake kind: ${wake.kind}`,
      `Wake reason: ${wake.reason}`,
      "Recent transcript:",
      recent || "(none)",
      "",
      "You are the right-side realtime coach. Return one concise coach message the user can say next.",
      "Do not return SILENT. Do not say you detected a question. Do not write long analysis.",
      "Prefer one directly speakable sentence or a compact answer skeleton.",
    ].join("\n"),
  };
}
