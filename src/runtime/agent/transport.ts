import type { AssistantSuggestion, CoachToolTrace } from "../../app/types";
import type { AgentPrompt } from "./prompt";
import { runPiObserver } from "../piObserver";

export type AgentTransport = {
  complete(prompt: AgentPrompt, callbacks?: AgentTransportCallbacks): Promise<AssistantSuggestion>;
};

export type AgentTransportCallbacks = {
  onDelta?: (delta: string) => void;
  onToolEnd?: (name: string, isError: boolean) => void;
  onToolStart?: (name: string) => void;
  onToolTrace?: (trace: CoachToolTrace) => void;
};

export function createPiCoachTransport(): AgentTransport {
  return {
    async complete(prompt, callbacks) {
      const result = await runPiObserver({
        documents: prompt.snapshot.documents,
        perspective: prompt.snapshot.perspective,
        prompt: prompt.text,
        sessionId: prompt.snapshot.sessionId ?? "meetly-coach",
        trigger: toObserverTrigger(prompt.wake.kind),
        onDelta: callbacks?.onDelta,
        onToolEnd: callbacks?.onToolEnd,
        onToolStart: callbacks?.onToolStart,
        onToolTrace: callbacks?.onToolTrace,
      });

      return {
        answer: result.text,
        bullets: [],
        clarifyingQuestion: null,
      };
    },
  };
}

function toObserverTrigger(kind: AgentPrompt["wake"]["kind"]) {
  if (kind === "enter") return "manual_ask_done";
  if (kind === "session_start") return "session_started";
  if (kind === "stt_signal") return "context_signal";
  return "question_detected";
}
