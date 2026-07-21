import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { isTauriRuntime } from "./platform";
import type {
  AssistantDeltaPayload,
  AssistantErrorPayload,
  AssistantSuggestion,
  AgentToolTraceEvent,
  AudioLevelChanged,
  CoachToolTrace,
  TranscriptError,
  TranscriptSegment,
} from "./types";
import type { MeetlyState } from "./useMeetlyState";
import type { AutoAssistActions } from "./useAutoAssist";
import type { SessionActions } from "./useSessionActions";
import type { AgentRuntimeActions } from "./useAgentRuntime";

export function useTauriEvents(
  ctx: MeetlyState,
  autoAssist: AutoAssistActions,
  session: SessionActions,
  agent: AgentRuntimeActions
) {
  useEffect(() => {
    if (!isTauriRuntime()) return;

    let disposed = false;
    let unlisten: (() => void) | undefined;

    void listen<boolean>("island_visibility_changed", (event) => {
      if (disposed) return;
      ctx.setIsHidden(!event.payload);
      if (event.payload) {
        ctx.setOpenPanel("assistant");
      }
    }).then((nextUnlisten) => {
      if (disposed) nextUnlisten();
      else unlisten = nextUnlisten;
    });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [ctx]);

  useEffect(() => {
    if (!isTauriRuntime()) return;

    let disposed = false;
    let unlisten: (() => void) | undefined;

    const levels = { system: 0, microphone: 0 };
    void listen<AudioLevelChanged>("audio_level_changed", (event) => {
      if (disposed) return;
      const source = event.payload.source ?? "system";
      levels[source] = event.payload.level;
      ctx.setAudioLevel(Math.max(levels.system, levels.microphone));
    }).then((nextUnlisten) => {
      if (disposed) nextUnlisten();
      else unlisten = nextUnlisten;
    });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [ctx]);

  useEffect(() => {
    if (!isTauriRuntime()) return;

    let disposed = false;
    let unlistenFinal: (() => void) | undefined;
    let unlistenError: (() => void) | undefined;

    void listen<TranscriptSegment>("transcript_final", (event) => {
      if (!disposed) autoAssist.addTranscriptSegment(event.payload);
    }).then((nextUnlisten) => {
      if (disposed) nextUnlisten();
      else unlistenFinal = nextUnlisten;
    });

    void listen<TranscriptError>("transcript_error", (event) => {
      if (!disposed) ctx.setTranscriptError(event.payload.message);
    }).then((nextUnlisten) => {
      if (disposed) nextUnlisten();
      else unlistenError = nextUnlisten;
    });

    return () => {
      disposed = true;
      unlistenFinal?.();
      unlistenError?.();
    };
  }, [autoAssist, ctx]);

  useEffect(() => {
    if (!isTauriRuntime()) return;

    let disposed = false;
    let unlisten: (() => void) | undefined;

    void listen<AgentToolTraceEvent>("agent_tool_trace", (event) => {
      if (disposed) return;
      const payload = event.payload;
      const trace: CoachToolTrace = {
        id: payload.traceId,
        name: payload.name,
        label: payload.label,
        status: payload.status,
        query: payload.query,
        content: payload.content,
        createdAt: payload.createdAt,
        completedAt: payload.completedAt,
      };

      const chatTurnIndex = ctx.agentChatTurnsRef.current.findIndex(
        (turn) => turn.id === payload.runId
      );
      if (chatTurnIndex >= 0) {
        const next = [...ctx.agentChatTurnsRef.current];
        const turn = next[chatTurnIndex];
        next[chatTurnIndex] = {
          ...turn,
          toolTraces: upsertToolTrace(turn.toolTraces, trace),
        };
        ctx.agentChatTurnsRef.current = next;
        ctx.setAgentChatTurns(next);
        return;
      }

      ctx.setCoachDraft((current) => {
        if (!current || current.id !== payload.runId) {
          return current;
        }
        const toolTraces = upsertToolTrace(current.toolTraces, trace);
        ctx.coachToolTracesRef.current = toolTraces;
        return { ...current, toolTraces };
      });
    }).then((nextUnlisten) => {
      if (disposed) nextUnlisten();
      else unlisten = nextUnlisten;
    });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [ctx]);

  useEffect(() => {
    if (!isTauriRuntime()) return;

    let disposed = false;
    let unlistenDelta: (() => void) | undefined;
    let unlistenDone: (() => void) | undefined;
    let unlistenError: (() => void) | undefined;

    void listen<AssistantDeltaPayload>("assistant_delta", (event) => {
      if (!disposed) ctx.setAssistantDraft((current) => current + event.payload.text);
    }).then((nextUnlisten) => {
      if (disposed) nextUnlisten();
      else unlistenDelta = nextUnlisten;
    });

    void listen<AssistantSuggestion>("assistant_done", (event) => {
      if (disposed) return;
      ctx.setAssistantSuggestion(event.payload);
      ctx.setAssistantDraft("");
      ctx.setAssistantError(null);
      ctx.setIsAsking(false);
      const askId = ctx.pendingAskIdRef.current;
      if (askId) {
        agent.recordManualAskFinished(askId, "spoken", "message_committed");
        session.updateInterviewSession((current) => ({
          ...current,
          status: current.endedAt ? "idle" : "listening",
          asks: current.asks.map((ask) =>
            ask.id === askId ? { ...ask, answer: event.payload.answer, error: null } : ask
          ),
        }));
        ctx.pendingAskIdRef.current = null;
      }
    }).then((nextUnlisten) => {
      if (disposed) nextUnlisten();
      else unlistenDone = nextUnlisten;
    });

    void listen<AssistantErrorPayload>("assistant_error", (event) => {
      if (disposed) return;
      ctx.setAssistantError(event.payload.message);
      ctx.setAssistantDraft("");
      ctx.setIsAsking(false);
      const askId = ctx.pendingAskIdRef.current;
      if (askId) {
        agent.recordManualAskFinished(askId, "failed", "run_failed");
        session.updateInterviewSession((current) => ({
          ...current,
          status: current.endedAt ? "idle" : "listening",
          asks: current.asks.map((ask) => ask.id === askId ? { ...ask, error: event.payload.message } : ask),
        }));
        ctx.pendingAskIdRef.current = null;
      }
    }).then((nextUnlisten) => {
      if (disposed) nextUnlisten();
      else unlistenError = nextUnlisten;
    });

    return () => {
      disposed = true;
      unlistenDelta?.();
      unlistenDone?.();
      unlistenError?.();
    };
  }, [agent, ctx, session]);
}

function upsertToolTrace(current: CoachToolTrace[], trace: CoachToolTrace) {
  const index = current.findIndex((item) => item.id === trace.id);
  if (index < 0) return [...current, trace];

  const next = [...current];
  next[index] = {
    ...next[index],
    ...trace,
    createdAt: next[index].createdAt,
  };
  return next;
}
