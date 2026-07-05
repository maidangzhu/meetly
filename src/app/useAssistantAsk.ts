import { useCallback, useEffect } from "react";
import { buildInterviewAskContext, transcriptSimilarity } from "./interviewLogic";
import { createId, debugLog, safeInvoke } from "./platform";
import type { MeetlyState } from "./useMeetlyState";
import type { SessionActions } from "./useSessionActions";
import type { WindowActions } from "./useWindowActions";

export function useAssistantAsk(
  ctx: MeetlyState,
  session: SessionActions,
  windowActions: WindowActions,
  flushCurrentMicSegment: () => Promise<void>
) {
  const askAssistant = useCallback(async () => {
    if (ctx.isAsking) {
      return;
    }

    ctx.setIsAsking(true);
    ctx.setAssistantError(null);
    ctx.setAssistantSuggestion(null);
    ctx.setAssistantDraft("");
    await windowActions.setPanel("assistant");

    try {
      await flushCurrentMicSegment();

      const askContext = buildInterviewAskContext(ctx.transcriptHistoryRef.current);
      if (!askContext) {
        debugLog("[ask] blocked no_mic_transcript");
        throw new Error("还没有面试/对话转写。先点左侧麦克风开启面试，等出第一段转写后再 Ask。");
      }

      const askId = createId("ask");
      ctx.pendingAskIdRef.current = askId;
      const activeHint = ctx.autoAssistHintRef.current;
      const cache = ctx.prefetchCacheRef.current;
      const now = Date.now();
      const hasFreshCache =
        cache &&
        cache.expiresAt > now &&
        activeHint?.candidate.id === cache.candidateId &&
        transcriptSimilarity(cache.questionText, askContext.latest.text) >= 0.82;

      if (hasFreshCache) {
        debugLog(`[auto] cache hit candidate=${cache.candidateId} ask=${askId} context=${cache.contextPreview.replace(/\n/g, " ")}`);
        ctx.setAssistantSuggestion(cache.suggestion);
        ctx.setAssistantDraft("");
        ctx.setAssistantError(null);
        ctx.setIsAsking(false);
        session.setCurrentAutoAssistHint(null);
        ctx.setPrefetchStatus("idle");
        ctx.prefetchCacheRef.current = null;
        session.updateInterviewSession((current) => ({
          ...current,
          status: current.endedAt ? "idle" : "listening",
          asks: [
            ...current.asks,
            {
              id: askId,
              createdAt: Date.now(),
              latestQuestion: askContext.latest.text,
              contextPreview: askContext.preview,
              answer: cache.suggestion.answer,
              error: null,
            },
          ],
        }));
        ctx.pendingAskIdRef.current = null;
        return;
      }

      debugLog(`[auto] cache miss ask=${askId} reason=${cache ? cache.expiresAt <= now ? "expired" : activeHint?.candidate.id !== cache.candidateId ? "candidate_mismatch" : "context_mismatch" : "empty"}`);
      ctx.prefetchInFlightRef.current = null;
      session.setCurrentAutoAssistHint(null);
      session.updateInterviewSession((current) => ({
        ...current,
        status: "asking",
        asks: [
          ...current.asks,
          {
            id: askId,
            createdAt: Date.now(),
            latestQuestion: askContext.latest.text,
            contextPreview: askContext.preview,
            answer: null,
            error: null,
          },
        ],
      }));

      debugLog(`[ask] submit mode=${ctx.assistantMode} latest_confidence=${askContext.latest.confidence.toFixed(2)} latest_reason=${askContext.latest.reason} recent_segments=${askContext.recentSegments.length} full_segments=${askContext.fullSegments.length} chars=${askContext.userMessage.length} preview=${askContext.preview.replace(/\n/g, " ")}`);
      await safeInvoke("ask_assistant_with_question", {
        mode: ctx.assistantMode,
        question: askContext.userMessage,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      ctx.setAssistantError(message);
      ctx.setAssistantDraft("");
      ctx.setIsAsking(false);
      const askId = ctx.pendingAskIdRef.current;
      if (askId) {
        session.updateInterviewSession((current) => ({
          ...current,
          status: current.endedAt ? "idle" : "listening",
          asks: current.asks.map((ask) => ask.id === askId ? { ...ask, error: message } : ask),
        }));
      }
      ctx.pendingAskIdRef.current = null;
    }
  }, [ctx, flushCurrentMicSegment, session, windowActions]);

  useEffect(() => {
    const handleAskShortcut = (event: KeyboardEvent) => {
      if (event.key !== "Enter" || event.shiftKey || event.metaKey || event.ctrlKey || event.altKey) {
        return;
      }

      const target = event.target as HTMLElement | null;
      const isTextInput =
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.isContentEditable;

      if (isTextInput) {
        return;
      }

      event.preventDefault();
      void askAssistant();
    };

    window.addEventListener("keydown", handleAskShortcut);
    return () => window.removeEventListener("keydown", handleAskShortcut);
  }, [askAssistant]);

  return { askAssistant };
}

export type AssistantAskActions = ReturnType<typeof useAssistantAsk>;
