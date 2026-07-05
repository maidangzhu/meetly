import { useCallback, useEffect } from "react";
import {
  MIC_MIN_SEGMENT_MS,
  MIC_SEGMENT_MS,
  MIC_VAD_INTERVAL_MS,
  MIC_VAD_RMS_THRESHOLD,
  MIC_VAD_SILENCE_MS,
} from "./constants";
import { blobToBase64, calculateRms, createId, debugLog, safeInvoke } from "./platform";
import { buildInterviewReportRequest, generateInterviewReport } from "./reporting";
import type { InterviewSession, TranscriptSegment } from "./types";
import type { AutoAssistActions } from "./useAutoAssist";
import type { MeetlyState } from "./useMeetlyState";
import type { SessionActions } from "./useSessionActions";
import type { WindowActions } from "./useWindowActions";

export function useMicMeeting(
  ctx: MeetlyState,
  autoAssist: AutoAssistActions,
  session: SessionActions,
  windowActions: WindowActions
) {
  const transcribeMicChunk = useCallback(async (
    blob: Blob,
    startMs: number,
    endMs: number
  ): Promise<TranscriptSegment | null> => {
    if (blob.size === 0) {
      debugLog("[mic] skip empty segment");
      return null;
    }

    const index = ctx.micChunkIndexRef.current;
    ctx.micChunkIndexRef.current += 1;
    debugLog(`[mic] transcribe segment index=${index} bytes=${blob.size} type=${blob.type}`);

    try {
      const audioBase64 = await blobToBase64(blob);
      const text = await safeInvoke<string>("transcribe_audio", {
        audioBase64,
        mimeType: blob.type,
      });
      const trimmed = text?.trim();

      if (!trimmed) {
        debugLog(`[mic] transcript empty index=${index}`);
        return null;
      }

      const segment: TranscriptSegment = {
        id: `mic-${Date.now().toString(16)}-${index}`,
        source: "microphone",
        speaker: "unknown",
        text: trimmed,
        startMs,
        endMs,
      };

      autoAssist.addTranscriptSegment(segment);
      debugLog(`[mic] transcript ok index=${index} start_ms=${startMs} end_ms=${endMs} chars=${trimmed.length} text=${trimmed.slice(0, 160).replace(/\n/g, " ")}`);
      return segment;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      ctx.setTranscriptError(message);
      debugLog(`[mic] transcript error index=${index} message=${message}`);
      return null;
    }
  }, [autoAssist, ctx]);

  const stopMicMeeting = useCallback(async () => {
    debugLog("[mic] stop requested");
    ctx.micStopRequestedRef.current = true;
    clearMicTimers(ctx);

    const recorder = ctx.mediaRecorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      recorder.stop();
      await ctx.currentRecorderStoppedRef.current;
    }
    await ctx.currentSegmentTranscriptionRef.current;

    closeMicResources(ctx);
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
      transcript: [],
      asks: [],
      autoAssistCandidate: null,
    };
    session.setCurrentInterviewSession(nextSession);
    debugLog(`[session] start id=${nextSession.id}`);
    debugLog("[mic] start requested");

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = MediaRecorder.isTypeSupported("audio/webm") ? "audio/webm" : "audio/ogg";

      ctx.micStreamRef.current = stream;
      ctx.micStartedAtRef.current = Date.now();
      ctx.micChunkIndexRef.current = 0;
      ctx.micStopRequestedRef.current = false;

      startVadLoop(ctx);
      startRecordingSegment(ctx, stream, mimeType, transcribeMicChunk);

      ctx.setAudioLevel(0.35);
      ctx.setState("listening");
      void windowActions.setPanel("assistant");
      debugLog(`[mic] started tracks=${stream.getAudioTracks().length} mime_type=${mimeType}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      ctx.setTranscriptError(`麦克风开启失败：${message}`);
      debugLog(`[mic] start error message=${message}`);
      session.updateInterviewSession((current) => ({
        ...current,
        endedAt: Date.now(),
        status: "error",
      }));
      ctx.setAudioLevel(0);
      ctx.setState("error");
    }
  }, [ctx, session, transcribeMicChunk, windowActions]);

  const toggleListening = useCallback(async () => {
    if (ctx.micStreamRef.current) {
      await stopMicMeeting();
      return;
    }

    await startMicMeeting();
  }, [ctx, startMicMeeting, stopMicMeeting]);

  const flushCurrentMicSegment = useCallback(async () => {
    const recorder = ctx.mediaRecorderRef.current;
    if (recorder?.state === "recording") {
      debugLog("[ask] flush current mic segment before ask");
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
  ctx.setTranscriptHistory([]);
  ctx.setAssistantSuggestion(null);
  ctx.setAssistantDraft("");
  ctx.setAssistantError(null);
  session.setCurrentAutoAssistHint(null);
  ctx.prefetchCacheRef.current = null;
  ctx.prefetchInFlightRef.current = null;
  ctx.recentQuestionCandidatesRef.current = [];
  ctx.lastHintShownAtRef.current = 0;
  ctx.setPrefetchStatus("idle");
  ctx.transcriptHistoryRef.current = [];
}

function startVadLoop(ctx: MeetlyState) {
  const stream = ctx.micStreamRef.current;
  const AudioContextCtor =
    window.AudioContext ??
    (window as Window & typeof globalThis & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!stream || !AudioContextCtor) {
    return;
  }

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
    const durationMs = now - ctx.currentSegmentStartedAtRef.current;
    if (rms >= MIC_VAD_RMS_THRESHOLD) {
      ctx.currentSegmentHeardSpeechRef.current = true;
      ctx.currentSegmentLastVoiceAtRef.current = now;
      return;
    }

    const silenceMs = now - ctx.currentSegmentLastVoiceAtRef.current;
    if (
      ctx.currentSegmentHeardSpeechRef.current &&
      durationMs >= MIC_MIN_SEGMENT_MS &&
      silenceMs >= MIC_VAD_SILENCE_MS
    ) {
      debugLog(`[mic] vad flush index=${ctx.micChunkIndexRef.current} duration_ms=${durationMs} silence_ms=${silenceMs} rms=${rms.toFixed(4)}`);
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
  transcribeMicChunk: (blob: Blob, startMs: number, endMs: number) => Promise<TranscriptSegment | null>
) {
  if (ctx.micStopRequestedRef.current || !ctx.micStreamRef.current) {
    return;
  }

  const chunks: Blob[] = [];
  const recorder = new MediaRecorder(stream, { mimeType });
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
      const blob = new Blob(chunks, { type: mimeType });
      const transcription = transcribeMicChunk(blob, segmentStartMs, segmentEndMs);
      ctx.currentSegmentTranscriptionRef.current = transcription;
      void transcription.finally(() => {
        if (ctx.currentSegmentTranscriptionRef.current === transcription) {
          ctx.currentSegmentTranscriptionRef.current = null;
        }
      });

      resolveStopped();
      if (!ctx.micStopRequestedRef.current && ctx.micStreamRef.current) {
        startRecordingSegment(ctx, stream, mimeType, transcribeMicChunk);
      }
    };
  });

  recorder.onstart = () => {
    debugLog(`[mic] segment start index=${ctx.micChunkIndexRef.current} start_ms=${segmentStartMs} mime_type=${mimeType}`);
  };

  recorder.start();
  ctx.micSegmentTimerRef.current = window.setTimeout(() => {
    if (recorder.state === "recording") {
      debugLog(`[mic] segment stop index=${ctx.micChunkIndexRef.current}`);
      recorder.stop();
    }
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
