import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { isTauriRuntime } from "./platform";
import type {
  AssistantDeltaPayload,
  AssistantErrorPayload,
  AssistantSuggestion,
  AudioLevelChanged,
  TranscriptError,
  TranscriptSegment,
} from "./types";
import type { MeetlyState } from "./useMeetlyState";
import type { AutoAssistActions } from "./useAutoAssist";
import type { PiCoachActions } from "./usePiCoach";
import type { SessionActions } from "./useSessionActions";

export function useTauriEvents(
  ctx: MeetlyState,
  autoAssist: AutoAssistActions,
  piCoach: PiCoachActions,
  session: SessionActions
) {
  useEffect(() => {
    if (!isTauriRuntime()) return;

    let disposed = false;
    let unlisten: (() => void) | undefined;

    void listen<AudioLevelChanged>("audio_level_changed", (event) => {
      if (!disposed) ctx.setAudioLevel(event.payload.level);
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
        session.updateInterviewSession((current) => ({
          ...current,
          status: current.endedAt ? "idle" : "listening",
          asks: current.asks.map((ask) =>
            ask.id === askId ? { ...ask, answer: event.payload.answer, error: null } : ask
          ),
        }));
        ctx.pendingAskIdRef.current = null;
      }
      void piCoach.runPiCoach({
        trigger: "manual_ask_done",
        latestAnswer: event.payload.answer,
        force: true,
      });
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
  }, [ctx, piCoach, session]);
}
