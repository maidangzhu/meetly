import { useCallback, useEffect } from "react";
import {
  MIC_MIN_SEGMENT_MS,
  MIC_SEGMENT_MS,
  MIC_VAD_INTERVAL_MS,
  MIC_VAD_RMS_THRESHOLD,
  MIC_VAD_SILENCE_MS,
} from "./constants";
import { resetCoachWakeState } from "./coachWakePolicy";
import { blobToBase64, calculateRms, createId, debugLog, safeInvoke } from "./platform";
import { getSupportedMicrophoneMimeType } from "./microphoneClip";
import { buildInterviewReportRequest, generateInterviewReport } from "./reporting";
import type { InterviewSession, TranscriptSegment } from "./types";
import type { AgentRuntimeActions } from "./useAgentRuntime";
import type { AutoAssistActions } from "./useAutoAssist";
import type { MeetlyState } from "./useMeetlyState";
import type { SessionActions } from "./useSessionActions";
import type { WindowActions } from "./useWindowActions";

export function useMicMeeting(
  ctx: MeetlyState,
  agent: AgentRuntimeActions,
  autoAssist: AutoAssistActions,
  session: SessionActions,
  windowActions: WindowActions
) {
  const transcribeMicChunk = useCallback(async (
    blob: Blob,
    startMs: number,
    endMs: number
  ): Promise<TranscriptSegment | null> => {
    if (blob.size === 0) return null;

    const index = ctx.micChunkIndexRef.current++;
    debugLog(`[mic] transcribe segment index=${index} bytes=${blob.size}`);

    try {
      const audioBase64 = await blobToBase64(blob);
      const text = await safeInvoke<string>("transcribe_audio", {
        audioBase64,
        mimeType: blob.type,
      });
      const trimmed = text?.trim();
      if (ctx.micStopRequestedRef.current || !trimmed) return null;

      const segment: TranscriptSegment = {
        id: `mic-${Date.now().toString(16)}-${index}`,
        source: "microphone",
        speaker: "unknown",
        text: trimmed,
        startMs,
        endMs,
      };
      autoAssist.addTranscriptSegment(segment);
      debugLog(`[mic] transcript ok index=${index} chars=${trimmed.length}`);
      return segment;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!ctx.micStopRequestedRef.current) ctx.setTranscriptError(message);
      debugLog(`[mic] transcript error index=${index} message=${message}`);
      return null;
    }
  }, [autoAssist, ctx]);

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
    const endedAt = Date.now();
    const reportSession: InterviewSession | null = session.updateInterviewSession((current) => {
      const next = {
        ...current,
        endedAt,
        status: "idle" as const,
      };
      debugLog(`[session] stop id=${next.id} transcript_count=${next.transcript.length} asks=${next.asks.length}`);
      return next;
    });
    if (reportSession) {
      agent.recordSessionEnded(reportSession.id);
    }
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
  }, [agent, ctx, session]);

  const startMicMeeting = useCallback(async () => {
    resetSessionUi(ctx, session);
    const nextSession: InterviewSession = {
      id: createId(ctx.sessionKind),
      kind: ctx.sessionKind,
      audioSource: ctx.audioSource,
      goal: ctx.sessionKind === "meeting" ? ctx.meetingGoal.trim() : "",
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
    agent.recordSessionStarted({
      sessionId: nextSession.id,
      sessionKind: nextSession.kind,
      audioSource: nextSession.audioSource,
      hasDocuments: nextSession.documents.length > 0,
    });
    debugLog(`[session] start id=${nextSession.id}`);
    debugLog(`[audio] start requested source=${ctx.audioSource} kind=${ctx.sessionKind}`);

    try {
      closeMicResources(ctx);
      ctx.micStartedAtRef.current = Date.now();
      ctx.micChunkIndexRef.current = 0;
      ctx.micStopRequestedRef.current = false;

      if (ctx.audioSource === "microphone") {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        });
        ctx.micStreamRef.current = stream;
        startVadLoop(ctx);
        const mimeType = getSupportedMicrophoneMimeType();
        startRecordingSegment(ctx, stream, mimeType, transcribeMicChunk);
      } else {
        await safeInvoke("start_listening");
      }
      ctx.setAudioLevel(0.35);
      ctx.setState("listening");
      void windowActions.setPanel("assistant");
      agent.recordCaptureStarted(nextSession.id, ctx.audioSource);
      agent.wakeSessionStart(nextSession.id, ctx.contextDocumentsRef.current.length > 0);
      debugLog(`[audio] ${ctx.audioSource} capture started`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      agent.recordCaptureFailed(nextSession.id, ctx.audioSource);
      ctx.setTranscriptError(`${ctx.audioSource === "microphone" ? "麦克风" : "会议音频"}监听失败：${message}`);
      debugLog(`[audio] start error message=${message}`);
      session.updateInterviewSession((current) => ({
        ...current,
        endedAt: Date.now(),
        status: "error",
      }));
      ctx.setAudioLevel(0);
      ctx.setState("error");
    }
  }, [agent, ctx, session, transcribeMicChunk, windowActions]);

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
  ctx.coachMessagesRef.current = [];
  ctx.setCoachMessages([]);
  ctx.setCoachDraft(null);
  ctx.setIsCoachThinking(false);
  session.setCurrentAutoAssistHint(null);
  ctx.prefetchCacheRef.current = null;
  ctx.prefetchInFlightRef.current = null;
  ctx.recentQuestionCandidatesRef.current = [];
  resetCoachWakeState(ctx.coachWakeStateRef.current);
  ctx.lastHintShownAtRef.current = 0;
  ctx.setPrefetchStatus("idle");
  ctx.transcriptHistoryRef.current = [];
}

function startVadLoop(ctx: MeetlyState) {
  const stream = ctx.micStreamRef.current;
  const AudioContextCtor = window.AudioContext ??
    (window as Window & typeof globalThis & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!stream || !AudioContextCtor) return;

  const audioContext = new AudioContextCtor();
  const source = audioContext.createMediaStreamSource(stream);
  const analyser = audioContext.createAnalyser();
  analyser.fftSize = 1024;
  source.connect(analyser);
  ctx.micAudioContextRef.current = audioContext;
  ctx.micAudioSourceRef.current = source;
  ctx.micAnalyserRef.current = analyser;
  ctx.micVadDataRef.current = new Uint8Array(analyser.fftSize);

  ctx.micVadTimerRef.current = window.setInterval(() => {
    const activeAnalyser = ctx.micAnalyserRef.current;
    const data = ctx.micVadDataRef.current;
    if (!activeAnalyser || !data) return;

    activeAnalyser.getByteTimeDomainData(data);
    const rms = calculateRms(data);
    ctx.setAudioLevel(Math.min(1, rms * 18));

    const recorder = ctx.mediaRecorderRef.current;
    if (!recorder || recorder.state !== "recording") return;

    const now = Date.now();
    if (rms >= MIC_VAD_RMS_THRESHOLD) {
      ctx.currentSegmentHeardSpeechRef.current = true;
      ctx.currentSegmentLastVoiceAtRef.current = now;
      return;
    }

    const durationMs = now - ctx.currentSegmentStartedAtRef.current;
    const silenceMs = now - ctx.currentSegmentLastVoiceAtRef.current;
    if (
      ctx.currentSegmentHeardSpeechRef.current &&
      durationMs >= MIC_MIN_SEGMENT_MS &&
      silenceMs >= MIC_VAD_SILENCE_MS
    ) {
      if (ctx.micSegmentTimerRef.current !== null) {
        window.clearTimeout(ctx.micSegmentTimerRef.current);
        ctx.micSegmentTimerRef.current = null;
      }
      recorder.stop();
    }
  }, MIC_VAD_INTERVAL_MS);
}

function startRecordingSegment(
  ctx: MeetlyState,
  stream: MediaStream,
  mimeType: string,
  transcribe: (blob: Blob, startMs: number, endMs: number) => Promise<TranscriptSegment | null>
) {
  if (ctx.micStopRequestedRef.current || !ctx.micStreamRef.current) return;

  const chunks: Blob[] = [];
  const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
  const segmentStartMs = Date.now() - ctx.micStartedAtRef.current;
  ctx.currentSegmentStartedAtRef.current = Date.now();
  ctx.currentSegmentHeardSpeechRef.current = false;
  ctx.currentSegmentLastVoiceAtRef.current = Date.now();
  ctx.mediaRecorderRef.current = recorder;

  recorder.ondataavailable = (event) => {
    if (event.data.size > 0) chunks.push(event.data);
  };

  ctx.currentRecorderStoppedRef.current = new Promise((resolveStopped) => {
    recorder.onstop = () => {
      ctx.micSegmentTimerRef.current = null;
      const segmentEndMs = Date.now() - ctx.micStartedAtRef.current;
      const blob = new Blob(chunks, { type: recorder.mimeType || mimeType });
      if (ctx.micStopRequestedRef.current) {
        resolveStopped();
        return;
      }

      const transcription = transcribe(blob, segmentStartMs, segmentEndMs);
      ctx.currentSegmentTranscriptionRef.current = transcription;
      void transcription.finally(() => {
        if (ctx.currentSegmentTranscriptionRef.current === transcription) {
          ctx.currentSegmentTranscriptionRef.current = null;
        }
      });

      resolveStopped();
      startRecordingSegment(ctx, stream, mimeType, transcribe);
    };
  });

  recorder.start();
  ctx.micSegmentTimerRef.current = window.setTimeout(() => {
    if (recorder.state === "recording") recorder.stop();
  }, MIC_SEGMENT_MS);
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
