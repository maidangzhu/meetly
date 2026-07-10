import type { AssistantSuggestion } from "../../app/types";
import { safeInvoke } from "../../app/platform";
import type { AgentPrompt } from "./prompt";

export type AgentTransport = {
  complete(prompt: AgentPrompt): Promise<AssistantSuggestion>;
};

export function createTauriAgentTransport(): AgentTransport {
  return {
    async complete(prompt) {
      const suggestion = await safeInvoke<AssistantSuggestion>("complete_assistant_with_question", {
        mode: "interview",
        question: prompt.text,
      });

      if (!suggestion) {
        throw new Error("Tauri LLM provider is unavailable.");
      }

      return suggestion;
    },
  };
}
