import { useCallback } from "react";
import {
  AUTO_ASSIST_CACHE_TTL_MS,
  AUTO_ASSIST_DEDUPE_WINDOW_MS,
  AUTO_ASSIST_HINT_COOLDOWN_MS,
  AUTO_ASSIST_HINT_TTL_MS,
  AUTO_ASSIST_PREFETCH_CONFIDENCE,
  AUTO_ASSIST_PREFETCH_ENABLED,
  FULL_SESSION_SEGMENT_LIMIT,
} from "./constants";
import {
  buildInterviewAskContext,
  detectQuestionCandidate,
  isLikelyDuplicateTranscript,
  transcriptSimilarity,
} from "./interviewLogic";
import { debugLog, safeInvoke } from "./platform";
import type { AssistantSuggestion, AutoAssistHint, PrefetchCache, QuestionCandidate, TranscriptSegment } from "./types";
import type { MeetlyState } from "./useMeetlyState";
import type { PiCoachActions } from "./usePiCoach";
import type { SessionActions } from "./useSessionActions";

export function useAutoAssist(ctx: MeetlyState, session: SessionActions, piCoach: PiCoachActions) {
  const startAutoAssistPrefetch = useCallback(async (candidate: QuestionCandidate) => {
    if (!AUTO_ASSIST_PREFETCH_ENABLED || candidate.confidence < AUTO_ASSIST_PREFETCH_CONFIDENCE) {
      return;
    }

    const currentInFlight = ctx.prefetchInFlightRef.current;
    if (currentInFlight) {
      if (candidate.confidence < currentInFlight.confidence + 0.12) {
        debugLog(`[auto] prefetch skipped reason=in_flight candidate=${candidate.id} active=${currentInFlight.candidateId}`);
        return;
      }
      debugLog(`[auto] prefetch supersede candidate=${candidate.id} previous=${currentInFlight.candidateId}`);
    }

    const askContext = buildInterviewAskContext(ctx.transcriptHistoryRef.current);
    if (!askContext) {
      debugLog(`[auto] prefetch skipped reason=no_context candidate=${candidate.id}`);
      return;
    }

    ctx.prefetchInFlightRef.current = {
      candidateId: candidate.id,
      questionText: candidate.text,
      confidence: candidate.confidence,
      startedAt: Date.now(),
    };
    ctx.setPrefetchStatus("prefetching");
    debugLog(`[auto] prefetch start candidate=${candidate.id} confidence=${candidate.confidence.toFixed(2)} kind=${candidate.kind} context_chars=${askContext.userMessage.length}`);

    try {
      const suggestion = await safeInvoke<AssistantSuggestion>("complete_assistant_with_question", {
        mode: ctx.assistantMode,
        question: askContext.userMessage,
      });
      const active = ctx.prefetchInFlightRef.current;
      if (!suggestion || active?.candidateId !== candidate.id) {
        if (active?.candidateId === candidate.id) {
          ctx.prefetchInFlightRef.current = null;
          ctx.setPrefetchStatus("idle");
        }
        debugLog(`[auto] prefetch stale candidate=${candidate.id}`);
        return;
      }

      const cache: PrefetchCache = {
        candidateId: candidate.id,
        questionText: candidate.text,
        suggestion,
        createdAt: Date.now(),
        expiresAt: Date.now() + AUTO_ASSIST_CACHE_TTL_MS,
        contextPreview: askContext.preview,
      };
      ctx.prefetchCacheRef.current = cache;
      ctx.prefetchInFlightRef.current = null;
      ctx.setPrefetchStatus("ready");
      debugLog(`[auto] prefetch success candidate=${candidate.id} answer_chars=${suggestion.answer.length}`);
    } catch (error) {
      const active = ctx.prefetchInFlightRef.current;
      if (active?.candidateId === candidate.id) {
        ctx.prefetchInFlightRef.current = null;
      }
      ctx.setPrefetchStatus("error");
      const message = error instanceof Error ? error.message : String(error);
      debugLog(`[auto] prefetch error candidate=${candidate.id} message=${message}`);
    }
  }, [ctx]);

  const handleQuestionCandidate = useCallback((candidate: QuestionCandidate) => {
    const now = Date.now();
    const recentCandidates = ctx.recentQuestionCandidatesRef.current.filter(
      (item) => now - item.createdAt <= AUTO_ASSIST_DEDUPE_WINDOW_MS
    );
    ctx.recentQuestionCandidatesRef.current = recentCandidates;

    const duplicate = recentCandidates.find((item) => transcriptSimilarity(item.text, candidate.text) >= 0.82);
    if (duplicate) {
      debugLog(`[auto] candidate ignored reason=dedupe candidate=${candidate.id} duplicate=${duplicate.id} similarity=${transcriptSimilarity(duplicate.text, candidate.text).toFixed(2)}`);
      return;
    }

    ctx.recentQuestionCandidatesRef.current = [...recentCandidates, candidate].slice(-12);
    void piCoach.runPiCoach({
      trigger: "question_detected",
      candidate,
    });

    const activeHint = ctx.autoAssistHintRef.current;
    const inCooldown = now - ctx.lastHintShownAtRef.current < AUTO_ASSIST_HINT_COOLDOWN_MS;
    const muchStronger = activeHint && candidate.confidence >= activeHint.candidate.confidence + 0.12;
    if (inCooldown && !muchStronger) {
      debugLog(`[auto] candidate ignored reason=cooldown candidate=${candidate.id} confidence=${candidate.confidence.toFixed(2)}`);
      return;
    }

    const hint: AutoAssistHint = {
      candidate,
      expiresAt: now + AUTO_ASSIST_HINT_TTL_MS,
    };
    ctx.lastHintShownAtRef.current = now;
    session.setCurrentAutoAssistHint(hint);
    session.updateInterviewSession((current) => ({ ...current, autoAssistCandidate: candidate }));
    debugLog(`[auto] hint shown candidate=${candidate.id} confidence=${candidate.confidence.toFixed(2)} kind=${candidate.kind} reason=${candidate.reason} text=${candidate.text.slice(0, 160).replace(/\n/g, " ")}`);
    void startAutoAssistPrefetch(candidate);
  }, [ctx, piCoach, session, startAutoAssistPrefetch]);

  const addTranscriptSegment = useCallback((segment: TranscriptSegment) => {
    const normalizedSegment: TranscriptSegment = {
      ...segment,
      source: segment.source ?? "microphone",
      speaker: segment.speaker ?? "unknown",
    };

    if (isLikelyDuplicateTranscript(normalizedSegment, ctx.transcriptHistoryRef.current)) {
      debugLog(`[mic] transcript duplicate suppressed id=${normalizedSegment.id} text=${normalizedSegment.text.slice(0, 160).replace(/\n/g, " ")}`);
      return;
    }

    const next = [...ctx.transcriptHistoryRef.current, normalizedSegment]
      .sort((left, right) => left.endMs - right.endMs)
      .slice(-FULL_SESSION_SEGMENT_LIMIT);

    ctx.transcriptHistoryRef.current = next;
    ctx.setLatestTranscript(next[next.length - 1] ?? null);
    ctx.setTranscriptError(null);
    ctx.setTranscriptHistory(next.slice(-20));
    session.updateInterviewSession((current) => ({ ...current, transcript: next }));

    const activeSession = ctx.interviewSessionRef.current;
    if (activeSession && !activeSession.endedAt && ctx.assistantMode === "interview") {
      const recentTranscript = next.filter((item) => normalizedSegment.endMs - item.endMs <= 120_000);
      const candidate = detectQuestionCandidate(normalizedSegment, recentTranscript);
      if (candidate) {
        debugLog(`[auto] candidate detected candidate=${candidate.id} confidence=${candidate.confidence.toFixed(2)} kind=${candidate.kind} reason=${candidate.reason}`);
        handleQuestionCandidate(candidate);
      }
    }
  }, [ctx, handleQuestionCandidate, session]);

  return {
    addTranscriptSegment,
    startAutoAssistPrefetch,
  };
}

export type AutoAssistActions = ReturnType<typeof useAutoAssist>;
