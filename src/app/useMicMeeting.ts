import { useCallback, useEffect } from "react";
import { resetCoachWakeState } from "./coachWakePolicy";
import { createId, debugLog, safeInvoke } from "./platform";
import { buildInterviewReportRequest, generateInterviewReport } from "./reporting";
import type { InterviewSession } from "./types";
import type { AgentRuntimeActions } from "./useAgentRuntime";
import type { MeetlyState } from "./useMeetlyState";
import type { SessionActions } from "./useSessionActions";
import type { WindowActions } from "./useWindowActions";

export function useMicMeeting(
  ctx: MeetlyState,
  agent: AgentRuntimeActions,
  session: SessionActions,
  windowActions: WindowActions
) {
  const stopMicMeeting = useCallback(async () => {
    const stopStartedAt = Date.now();
    debugLog("[audio] stop requested");
    ctx.micStopRequestedRef.current = true;
    clearMicTimers(ctx);

    const recorder = ctx.mediaRecorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      const stopped = ctx.currentRecorderStoppedRef.current;
      debugLog(`[mic] recorder stop requested state=${recorder.state}`);
      try {
        recorder.stop();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        debugLog(`[mic] recorder stop error message=${message}`);
      }
      if (stopped) {
        void stopped.finally(() => {
          debugLog(`[mic] recorder stopped after_stop_ms=${Date.now() - stopStartedAt}`);
        });
      }
    }

    closeMicResources(ctx);
    try {
      await safeInvoke("stop_listening");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      debugLog(`[audio] stop system capture error message=${message}`);
    }
    ctx.setPartialTranscript(null);
    session.setCurrentAutoAssistHint(null);
    ctx.prefetchInFlightRef.current = null;
    ctx.prefetchCacheRef.current = null;
    ctx.setPrefetchStatus("idle");
    ctx.setAudioLevel(0);
    ctx.setState("idle");
    let reportSession: InterviewSession | null = null;
    const endedAt = Date.now();
    session.updateInterviewSession((current) => {
      const next = {
        ...current,
        endedAt,
        status: "idle" as const,
      };
      reportSession = next;
      debugLog(`[session] stop id=${next.id} transcript_count=${next.transcript.length} asks=${next.asks.length}`);
      return next;
    });
    debugLog(`[audio] stop completed ui_ms=${Date.now() - stopStartedAt}`);

    if (reportSession) {
      void generateInterviewReport(
        buildInterviewReportRequest({
          assistantMode: ctx.assistantMode,
          coachMessages: ctx.coachMessagesRef.current,
          endedAt,
          session: reportSession,
        })
      );
    }
  }, [ctx, session]);

  const startMicMeeting = useCallback(async () => {
    resetSessionUi(ctx, session);
    const nextSession: InterviewSession = {
      id: createId("interview"),
      startedAt: Date.now(),
      endedAt: null,
      status: "listening",
      perspective: ctx.meetingPerspective,
      documents: ctx.contextDocumentsRef.current,
      transcript: [],
      asks: [],
      autoAssistCandidate: null,
    };
    session.setCurrentInterviewSession(nextSession);
    debugLog(`[session] start id=${nextSession.id}`);
    debugLog("[audio] start requested source=system");

    try {
      closeMicResources(ctx);
      ctx.micStartedAtRef.current = Date.now();
      ctx.micChunkIndexRef.current = 0;
      ctx.micStopRequestedRef.current = false;

      await safeInvoke("start_listening");
      ctx.setAudioLevel(0.35);
      ctx.setState("listening");
      void windowActions.setPanel("assistant");
      agent.wakeSessionStart(nextSession.id, ctx.contextDocumentsRef.current.length > 0);
      debugLog("[audio] system capture started");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      ctx.setTranscriptError(`会议音频监听失败：${message}`);
      debugLog(`[audio] start error message=${message}`);
      session.updateInterviewSession((current) => ({
        ...current,
        endedAt: Date.now(),
        status: "error",
      }));
      ctx.setAudioLevel(0);
      ctx.setState("error");
    }
  }, [agent, ctx, session, windowActions]);

  const toggleListening = useCallback(async () => {
    if (ctx.state === "listening") {
      await stopMicMeeting();
      return;
    }

    await startMicMeeting();
  }, [ctx.state, startMicMeeting, stopMicMeeting]);

  const flushCurrentMicSegment = useCallback(async () => {
    const recorder = ctx.mediaRecorderRef.current;
    if (recorder?.state === "recording") {
      debugLog("[ask] stopping legacy microphone recorder before ask");
      if (ctx.micSegmentTimerRef.current !== null) {
        window.clearTimeout(ctx.micSegmentTimerRef.current);
        ctx.micSegmentTimerRef.current = null;
      }
      recorder.stop();
      await ctx.currentRecorderStoppedRef.current;
    }

    await ctx.currentSegmentTranscriptionRef.current;
  }, [ctx]);

  useEffect(() => {
    return () => {
      ctx.micStopRequestedRef.current = true;
      clearMicTimers(ctx);
      closeMicResources(ctx);
      void safeInvoke("stop_listening").catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        debugLog(`[audio] cleanup stop system capture error message=${message}`);
      });
      if (ctx.hintExpiryTimerRef.current !== null) {
        window.clearTimeout(ctx.hintExpiryTimerRef.current);
      }
    };
    // The refs and setters inside ctx are stable for the component lifetime.
    // Depending on the ctx object itself would run this cleanup on every render
    // and immediately stop a newly opened microphone stream.
  }, []);

  return {
    flushCurrentMicSegment,
    startMicMeeting,
    stopMicMeeting,
    toggleListening,
  };
}

function resetSessionUi(ctx: MeetlyState, session: SessionActions) {
  ctx.setState("thinking");
  ctx.setTranscriptError(null);
  ctx.setLatestTranscript(null);
  ctx.setPartialTranscript(null);
  ctx.setTranscriptHistory([]);
  ctx.setAssistantSuggestion(null);
  ctx.setAssistantDraft("");
  ctx.setAssistantError(null);
  if (ctx.coachActivityClearTimerRef.current !== null) {
    window.clearTimeout(ctx.coachActivityClearTimerRef.current);
    ctx.coachActivityClearTimerRef.current = null;
  }
  ctx.setCoachActivity(null);
  session.setCurrentAutoAssistHint(null);
  ctx.prefetchCacheRef.current = null;
  ctx.prefetchInFlightRef.current = null;
  ctx.recentQuestionCandidatesRef.current = [];
  resetCoachWakeState(ctx.coachWakeStateRef.current);
  ctx.lastHintShownAtRef.current = 0;
  ctx.setPrefetchStatus("idle");
  ctx.transcriptHistoryRef.current = [];
}

function clearMicTimers(ctx: MeetlyState) {
  if (ctx.micSegmentTimerRef.current !== null) {
    window.clearTimeout(ctx.micSegmentTimerRef.current);
    ctx.micSegmentTimerRef.current = null;
  }
  if (ctx.micVadTimerRef.current !== null) {
    window.clearInterval(ctx.micVadTimerRef.current);
    ctx.micVadTimerRef.current = null;
  }
}

function closeMicResources(ctx: MeetlyState) {
  ctx.micStreamRef.current?.getTracks().forEach((track) => track.stop());
  void ctx.micAudioContextRef.current?.close().catch(() => undefined);
  ctx.mediaRecorderRef.current = null;
  ctx.micStreamRef.current = null;
  ctx.micAudioContextRef.current = null;
  ctx.micAudioSourceRef.current = null;
  ctx.micAnalyserRef.current = null;
  ctx.micVadDataRef.current = null;
}

export type MicMeetingActions = ReturnType<typeof useMicMeeting>;
