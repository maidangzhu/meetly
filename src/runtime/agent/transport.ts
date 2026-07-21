import { invoke } from "@tauri-apps/api/core";
import type { AssistantSuggestion, CoachToolTrace } from "../../app/types";
import type { AgentPrompt } from "./prompt";

const COACH_REQUEST_TIMEOUT_MS = 10_000;

export type AgentTransport = {
  complete(prompt: AgentPrompt, callbacks?: AgentTransportCallbacks): Promise<AssistantSuggestion>;
};

export type AgentTransportCallbacks = {
  onDelta?: (delta: string) => void;
  onRetry?: (attempt: number, reason: string) => void;
  onToolEnd?: (name: string, isError: boolean) => void;
  onToolStart?: (name: string) => void;
  onToolTrace?: (trace: CoachToolTrace) => void;
};

export function createPiCoachTransport(): AgentTransport {
  return {
    async complete(prompt, callbacks) {
      const mode = prompt.snapshot.sessionKind === "remote" || prompt.snapshot.sessionKind === "in_person"
        ? "meeting"
        : prompt.snapshot.perspective === "interviewer"
          ? "interviewer"
          : "interview";
      const suggestion = await runWithOneTimeoutRetry(
        () => invoke<AssistantSuggestion>("complete_assistant_with_question", {
          mode,
          question: prompt.text,
          runId: prompt.wake.id,
          documents: prompt.snapshot.documents,
        }),
        COACH_REQUEST_TIMEOUT_MS,
        () => callbacks?.onRetry?.(2, "request_timeout")
      );

      if (!suggestion.answer.trim()) {
        throw new Error("场边教练返回了空内容。");
      }

      return suggestion;
    },
  };
}

export async function runWithOneTimeoutRetry<T>(
  operation: () => Promise<T>,
  timeoutMs: number,
  onRetry?: () => void
): Promise<T> {
  try {
    return await withTimeout(operation(), timeoutMs);
  } catch (error) {
    if (!(error instanceof CoachRequestTimeoutError)) throw error;
    onRetry?.();
    try {
      return await withTimeout(operation(), timeoutMs);
    } catch (retryError) {
      if (retryError instanceof CoachRequestTimeoutError) {
        throw new Error(`场边教练连续两次超过 ${Math.round(timeoutMs / 1000)} 秒，已结束本轮请求。`);
      }
      throw retryError;
    }
  }
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number) {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new CoachRequestTimeoutError()), timeoutMs);
  });

  return Promise.race([promise, timeout]).finally(() => {
    if (timeoutId !== null) clearTimeout(timeoutId);
  });
}

class CoachRequestTimeoutError extends Error {
  constructor() {
    super("COACH_REQUEST_TIMEOUT");
    this.name = "CoachRequestTimeoutError";
  }
}
