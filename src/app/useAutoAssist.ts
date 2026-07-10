import { useCallback } from "react";
import { FULL_SESSION_SEGMENT_LIMIT } from "./constants";
import { isLikelyDuplicateTranscript } from "./interviewLogic";
import { debugLog } from "./platform";
import type { TranscriptSegment } from "./types";
import type { AgentRuntimeActions } from "./useAgentRuntime";
import type { MeetlyState } from "./useMeetlyState";
import type { SessionActions } from "./useSessionActions";

export function useAutoAssist(ctx: MeetlyState, session: SessionActions, agent: AgentRuntimeActions) {
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
    agent.pushTranscriptFinal(normalizedSegment);
  }, [agent, ctx, session]);

  return {
    addTranscriptSegment,
  };
}

export type AutoAssistActions = ReturnType<typeof useAutoAssist>;
