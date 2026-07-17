import type { AssistantSuggestion, CoachToolTrace } from "../../app/types";
import { ContextStore } from "./contextStore";
import { buildAgentPrompt } from "./prompt";
import type { AgentTransport } from "./transport";
import type { WakeEvent } from "./wake";

const AGENT_CONTEXT_WINDOW_MS = 120_000;
const STT_WAKE_COOLDOWN_MS = 10_000;
const RECENT_EVIDENCE_TTL_MS = 60_000;

export type AgentRuntimeCallbacks = {
  onDelta?: (delta: string, wake: WakeEvent) => void;
  onRetry?: (attempt: number, reason: string, wake: WakeEvent) => void;
  onWakeStart?: (wake: WakeEvent) => void;
  onWakeSkipped?: (wake: WakeEvent, reason: string) => void;
  onMessage: (suggestion: AssistantSuggestion, wake: WakeEvent) => void;
  onError: (message: string, wake: WakeEvent) => void;
  onToolEnd?: (name: string, isError: boolean, wake: WakeEvent) => void;
  onToolStart?: (name: string, wake: WakeEvent) => void;
  onToolTrace?: (trace: CoachToolTrace, wake: WakeEvent) => void;
};

export class AgentRuntime {
  private callbacks: AgentRuntimeCallbacks;
  private inFlight = false;
  private queue: WakeEvent[] = [];
  private lastCoachMessageAtMs = 0;
  private pendingSttWake: WakeEvent | null = null;
  private pendingSttTimer: number | null = null;
  private recentEvidence: Array<{ text: string; handledAtMs: number }> = [];
  private interactionEpoch = 0;
  private manualAskActive = false;

  constructor(
    private context: ContextStore,
    private transport: AgentTransport,
    callbacks: AgentRuntimeCallbacks
  ) {
    this.callbacks = callbacks;
  }

  setCallbacks(callbacks: AgentRuntimeCallbacks) {
    this.callbacks = callbacks;
  }

  beginManualAsk() {
    this.manualAskActive = true;
    this.interactionEpoch += 1;
    this.queue = [];
    this.pendingSttWake = null;
    if (this.pendingSttTimer !== null) {
      window.clearTimeout(this.pendingSttTimer);
      this.pendingSttTimer = null;
    }
  }

  finishManualAsk() {
    this.manualAskActive = false;
  }

  wake(event: WakeEvent) {
    if (this.manualAskActive) {
      this.callbacks.onWakeSkipped?.(event, "manual_ask_active");
      return;
    }

    if (isTranscriptWake(event) && (this.inFlight || this.queue.length > 0)) {
      this.pendingSttWake = event;
      this.callbacks.onWakeSkipped?.(event, "stt_coalesced_while_in_flight");
      return;
    }

    const skipReason = this.getSkipReason(event);
    if (skipReason) {
      this.callbacks.onWakeSkipped?.(event, skipReason);
      return;
    }

    this.queue.push(event);
    this.queue.sort((left, right) => right.priority - left.priority);
    void this.drain();
  }

  private async drain() {
    if (this.inFlight) return;
    this.inFlight = true;

    try {
      while (this.queue.length > 0) {
        const wake = this.queue.shift()!;
        const epoch = this.interactionEpoch;
        this.callbacks.onWakeStart?.(wake);

        try {
          const snapshot = this.context.snapshot(AGENT_CONTEXT_WINDOW_MS);
          const prompt = buildAgentPrompt(wake, snapshot);
          const suggestion = await this.transport.complete(prompt, {
            onDelta: (delta) => {
              if (epoch === this.interactionEpoch) this.callbacks.onDelta?.(delta, wake);
            },
            onRetry: (attempt, reason) => {
              if (epoch === this.interactionEpoch) this.callbacks.onRetry?.(attempt, reason, wake);
            },
            onToolEnd: (name, isError) => {
              if (epoch === this.interactionEpoch) this.callbacks.onToolEnd?.(name, isError, wake);
            },
            onToolStart: (name) => {
              if (epoch === this.interactionEpoch) this.callbacks.onToolStart?.(name, wake);
            },
            onToolTrace: (trace) => {
              if (epoch === this.interactionEpoch) this.callbacks.onToolTrace?.(trace, wake);
            },
          });
          if (epoch !== this.interactionEpoch) {
            this.callbacks.onWakeSkipped?.(wake, "superseded_by_manual_ask");
            continue;
          }
          this.markHandled(wake);
          this.callbacks.onMessage(suggestion, wake);
        } catch (error) {
          if (epoch !== this.interactionEpoch) {
            this.callbacks.onWakeSkipped?.(wake, "superseded_by_manual_ask");
            continue;
          }
          this.callbacks.onError(error instanceof Error ? error.message : String(error), wake);
        }
      }
    } finally {
      this.inFlight = false;
      if (!this.manualAskActive) this.schedulePendingSttWake();
    }
  }

  private getSkipReason(event: WakeEvent) {
    if (event.kind === "enter" || event.kind === "session_start") {
      return null;
    }

    const now = Date.now();
    this.recentEvidence = this.recentEvidence.filter(
      (item) => now - item.handledAtMs <= RECENT_EVIDENCE_TTL_MS
    );

    if (this.lastCoachMessageAtMs && now - this.lastCoachMessageAtMs < STT_WAKE_COOLDOWN_MS) {
      return "stt_cooldown";
    }

    const evidence = normalizeEvidence(event.evidence[0] ?? "");
    if (evidence && this.recentEvidence.some((item) => isSimilarEvidence(item.text, evidence))) {
      return "stt_duplicate";
    }

    return null;
  }

  private markHandled(event: WakeEvent) {
    this.lastCoachMessageAtMs = Date.now();
    const evidence = normalizeEvidence(event.evidence[0] ?? "");
    if (evidence) {
      this.recentEvidence.push({ text: evidence, handledAtMs: this.lastCoachMessageAtMs });
    }
  }

  private schedulePendingSttWake() {
    if (!this.pendingSttWake || this.inFlight || this.queue.length > 0 || this.pendingSttTimer !== null) {
      return;
    }

    const delayMs = Math.max(
      0,
      STT_WAKE_COOLDOWN_MS - (Date.now() - this.lastCoachMessageAtMs)
    );

    this.pendingSttTimer = window.setTimeout(() => {
      this.pendingSttTimer = null;
      const pending = this.pendingSttWake;
      this.pendingSttWake = null;
      if (!pending) return;

      const skipReason = this.getSkipReason(pending);
      if (skipReason) {
        this.callbacks.onWakeSkipped?.(pending, skipReason);
        return;
      }

      this.queue.push(pending);
      void this.drain();
    }, delayMs);
  }
}

function isTranscriptWake(event: WakeEvent) {
  return event.kind === "stt_question" || event.kind === "stt_signal";
}

function normalizeEvidence(text: string) {
  return text.toLowerCase().replace(/\s+/g, "").replace(/[，。！？!?.,;；:："'“”‘’]/g, "");
}

function isSimilarEvidence(left: string, right: string) {
  if (!left || !right) return false;
  if (left === right) return true;
  if (left.length >= 8 && right.length >= 8 && (left.includes(right) || right.includes(left))) {
    return true;
  }
  return false;
}
