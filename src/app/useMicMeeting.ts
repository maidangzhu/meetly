import { useCallback, useEffect, useRef, type MutableRefObject } from "react";
import {
  MIC_MIN_SEGMENT_MS,
  MIC_SEGMENT_MS,
  MIC_VAD_INTERVAL_MS,
  MIC_VAD_RMS_THRESHOLD,
  MIC_VAD_SILENCE_MS,
} from "./constants";
import { resetCoachWakeState } from "./coachWakePolicy";
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
  const workletNodeRef = useRef<AudioWorkletNode | null>(null);
  const micMuteRef = useRef<GainNode | null>(null);
  const realtimeStateRef = useRef(createRealtimeMicState());
  const realtimeSampleRateRef = useRef(REALTIME_SAMPLE_RATE);
  const pendingTranscriptionsRef = useRef<Set<Promise<unknown>>>(new Set());
  const partialGenerationRef = useRef(0);
  const sentenceGenerationRef = useRef(0);

  const trackTranscription = useCallback((promise: Promise<unknown>) => {
    pendingTranscriptionsRef.current.add(promise);
    void promise.finally(() => {
      pendingTranscriptionsRef.current.delete(promise);
    });
  }, []);

  const transcribePcmChunk = useCallback(async (
    pcm: Float32Array,
    startMs: number,
    endMs: number,
    kind: "partial" | "final",
    generation: number,
    partialGeneration?: number
  ): Promise<TranscriptSegment | null> => {
    if (pcm.length === 0) return null;

    const index = ctx.micChunkIndexRef.current;
    if (kind === "final") {
      ctx.micChunkIndexRef.current += 1;
    }

    debugLog(`[mic-rt] transcribe ${kind} index=${index} samples=${pcm.length} start_ms=${startMs} end_ms=${endMs}`);

    try {
      const audioBase64 = encodeWavDataUrl(pcm, realtimeSampleRateRef.current);
      const text = await safeInvoke<string>("transcribe_audio", {
        audioBase64,
        mimeType: "audio/wav",
      });
      const trimmed = text?.trim();

      if (
        ctx.micStopRequestedRef.current ||
        generation !== sentenceGenerationRef.current ||
        (kind === "partial" && partialGeneration !== partialGenerationRef.current)
      ) {
        debugLog(`[mic-rt] ${kind} ignored stale_or_stopped index=${index}`);
        return null;
      }

      if (!trimmed) {
        debugLog(`[mic-rt] ${kind} empty index=${index}`);
        if (kind === "final") ctx.setPartialTranscript(null);
        return null;
      }

      if (kind === "partial") {
        ctx.setPartialTranscript({ text: trimmed, startMs, endMs });
        debugLog(`[mic-rt] partial ok index=${index} chars=${trimmed.length} text=${previewText(trimmed)}`);
        return null;
      }

      ctx.setPartialTranscript(null);
      const segment: TranscriptSegment = {
        id: `mic-${Date.now().toString(16)}-${index}`,
        source: "microphone",
        speaker: "unknown",
        text: trimmed,
        startMs,
        endMs,
      };

      autoAssist.addTranscriptSegment(segment);
      debugLog(`[mic-rt] final ok index=${index} chars=${trimmed.length} text=${previewText(trimmed)}`);
      return segment;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (ctx.micStopRequestedRef.current) {
        debugLog(`[mic-rt] ${kind} error ignored after stop index=${index} message=${message}`);
        return null;
      }
      if (kind === "final") {
        ctx.setTranscriptError(message);
      }
      debugLog(`[mic-rt] ${kind} error index=${index} message=${message}`);
      return null;
    }
  }, [autoAssist, ctx]);

  const runRealtimeTranscription = useCallback((
    pcm: Float32Array,
    startMs: number,
    endMs: number,
    kind: "partial" | "final"
  ) => {
    const generation = sentenceGenerationRef.current;
    if (kind === "partial") {
      partialGenerationRef.current += 1;
      const partialGeneration = partialGenerationRef.current;
      const promise = transcribePcmChunk(pcm, startMs, endMs, kind, generation, partialGeneration);
      trackTranscription(promise);
      return promise;
    }

    partialGenerationRef.current += 1;
    const promise = transcribePcmChunk(pcm, startMs, endMs, kind, generation);
    ctx.currentSegmentTranscriptionRef.current = promise;
    void promise.finally(() => {
      if (ctx.currentSegmentTranscriptionRef.current === promise) {
        ctx.currentSegmentTranscriptionRef.current = null;
      }
    });
    trackTranscription(promise);
    return promise;
  }, [ctx, trackTranscription, transcribePcmChunk]);

  const processRealtimeFrame = useCallback((frame: Float32Array) => {
    if (ctx.micStopRequestedRef.current) return;

    const state = realtimeStateRef.current;
    const frameMs = frame.length / realtimeSampleRateRef.current * 1000;
    state.elapsedMs += frameMs;
    const endMs = Math.round(state.elapsedMs);
    const level = calculateFloatRms(frame);
    ctx.setAudioLevel(Math.min(1, level * 18));

    const threshold = Math.max(REALTIME_ABS_SILENCE_RMS, state.noiseFloor * REALTIME_NOISE_RATIO);
    const speechy = level > threshold;
    if (!speechy) {
      state.noiseFloor = Math.min(
        state.noiseFloor * 1.02,
        Math.max(level, REALTIME_ABS_SILENCE_RMS / 4)
      );
      if (level < state.noiseFloor) state.noiseFloor = level;
    }

    const chunk: RealtimeFrame = { pcm: frame, endMs, ms: frameMs };
    if (!state.inSpeech) {
      if (speechy) {
        state.inSpeech = true;
        state.silenceMs = 0;
        state.speechMs = frameMs;
        state.segmentStartMs = Math.max(0, Math.round(endMs - frameMs - state.preRollMsHeld));
        state.lastSpeechMs = endMs;
        state.segment = [...state.preRoll, chunk];
        state.lastPartialAtMs = 0;
        state.preRoll = [];
        state.preRollMsHeld = 0;
        debugLog(`[mic-rt] speech start start_ms=${state.segmentStartMs} rms=${level.toFixed(4)} threshold=${threshold.toFixed(4)}`);
      } else {
        state.preRoll.push(chunk);
        state.preRollMsHeld += frameMs;
        while (state.preRollMsHeld > REALTIME_PREROLL_MS && state.preRoll.length > 1) {
          state.preRollMsHeld -= state.preRoll[0].ms;
          state.preRoll.shift();
        }
      }
      return;
    }

    state.segment.push(chunk);
    if (speechy) {
      state.silenceMs = 0;
      state.speechMs += frameMs;
      state.lastSpeechMs = endMs;
    } else {
      state.silenceMs += frameMs;
    }

    const segmentMs = state.segment.reduce((sum, item) => sum + item.ms, 0);
    if (state.silenceMs >= REALTIME_HANGOVER_MS) {
      closeRealtimeSegment(state, "silence", runRealtimeTranscription);
    } else if (segmentMs >= REALTIME_MAX_SEGMENT_MS) {
      closeRealtimeSegment(state, "maxlen", runRealtimeTranscription);
    } else if (speechy && segmentMs - state.lastPartialAtMs >= REALTIME_PARTIAL_INTERVAL_MS) {
      state.lastPartialAtMs = segmentMs;
      const pcm = concatRealtimeFrames(state.segment);
      void runRealtimeTranscription(pcm, state.segmentStartMs, endMs, "partial");
    }
  }, [ctx, runRealtimeTranscription]);

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

      if (ctx.micStopRequestedRef.current) {
        debugLog(`[mic] transcript ignored after stop index=${index}`);
        return null;
      }

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
      if (ctx.micStopRequestedRef.current) {
        debugLog(`[mic] transcript error ignored after stop index=${index} message=${message}`);
        return null;
      }
      ctx.setTranscriptError(message);
      debugLog(`[mic] transcript error index=${index} message=${message}`);
      return null;
    }
  }, [autoAssist, ctx]);

  const stopMicMeeting = useCallback(async () => {
    const stopStartedAt = Date.now();
    debugLog("[mic] stop requested");
    ctx.micStopRequestedRef.current = true;
    clearMicTimers(ctx);
    closeRealtimeMicResources(workletNodeRef, micMuteRef);

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
    debugLog(`[mic] stop completed ui_ms=${Date.now() - stopStartedAt}`);

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
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      ctx.micStreamRef.current = stream;
      ctx.micStartedAtRef.current = Date.now();
      ctx.micChunkIndexRef.current = 0;
      ctx.micStopRequestedRef.current = false;
      realtimeStateRef.current = createRealtimeMicState();
      realtimeSampleRateRef.current = REALTIME_SAMPLE_RATE;
      sentenceGenerationRef.current += 1;
      partialGenerationRef.current += 1;

      await startRealtimeMicWorklet(
        ctx,
        stream,
        workletNodeRef,
        micMuteRef,
        (sampleRate) => {
          realtimeSampleRateRef.current = sampleRate;
        },
        processRealtimeFrame
      );

      ctx.setAudioLevel(0.35);
      ctx.setState("listening");
      void windowActions.setPanel("assistant");
      debugLog(`[mic-rt] started tracks=${stream.getAudioTracks().length} sample_rate=${ctx.micAudioContextRef.current?.sampleRate ?? "unknown"}`);
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
  }, [ctx, processRealtimeFrame, session, windowActions]);

  const toggleListening = useCallback(async () => {
    if (ctx.micStreamRef.current) {
      await stopMicMeeting();
      return;
    }

    await startMicMeeting();
  }, [ctx, startMicMeeting, stopMicMeeting]);

  const flushCurrentMicSegment = useCallback(async () => {
    const realtimeState = realtimeStateRef.current;
    if (realtimeState.inSpeech) {
      debugLog("[ask] flush current realtime mic segment before ask");
      closeRealtimeSegment(realtimeState, "flush", runRealtimeTranscription);
    }

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
    await Promise.allSettled([...pendingTranscriptionsRef.current]);
  }, [ctx, runRealtimeTranscription]);

  useEffect(() => {
    return () => {
      ctx.micStopRequestedRef.current = true;
      clearMicTimers(ctx);
      closeRealtimeMicResources(workletNodeRef, micMuteRef);
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
      if (ctx.micStopRequestedRef.current) {
        debugLog(`[mic] skip final transcription after stop bytes=${blob.size}`);
        resolveStopped();
        return;
      }

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

const REALTIME_SAMPLE_RATE = 16_000;
const REALTIME_FRAME_MS = 100;
const REALTIME_PREROLL_MS = 300;
const REALTIME_HANGOVER_MS = 700;
const REALTIME_MIN_SPEECH_MS = 250;
const REALTIME_MAX_SEGMENT_MS = 10_000;
const REALTIME_ABS_SILENCE_RMS = 0.004;
const REALTIME_NOISE_RATIO = 3;
const REALTIME_PARTIAL_INTERVAL_MS = 1_300;

type RealtimeFrame = {
  pcm: Float32Array;
  endMs: number;
  ms: number;
};

type RealtimeMicState = {
  elapsedMs: number;
  inSpeech: boolean;
  silenceMs: number;
  speechMs: number;
  segmentStartMs: number;
  lastSpeechMs: number;
  lastPartialAtMs: number;
  noiseFloor: number;
  segment: RealtimeFrame[];
  preRoll: RealtimeFrame[];
  preRollMsHeld: number;
};

function createRealtimeMicState(): RealtimeMicState {
  return {
    elapsedMs: 0,
    inSpeech: false,
    lastPartialAtMs: 0,
    lastSpeechMs: 0,
    noiseFloor: REALTIME_ABS_SILENCE_RMS,
    preRoll: [],
    preRollMsHeld: 0,
    segment: [],
    segmentStartMs: 0,
    silenceMs: 0,
    speechMs: 0,
  };
}

async function startRealtimeMicWorklet(
  ctx: MeetlyState,
  stream: MediaStream,
  workletNodeRef: MutableRefObject<AudioWorkletNode | null>,
  micMuteRef: MutableRefObject<GainNode | null>,
  onSampleRate: (sampleRate: number) => void,
  onFrame: (frame: Float32Array) => void
) {
  const AudioContextCtor =
    window.AudioContext ??
    (window as Window & typeof globalThis & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextCtor) {
    throw new Error("当前浏览器环境不支持 AudioContext。");
  }

  const audioContext = new AudioContextCtor({ sampleRate: REALTIME_SAMPLE_RATE });
  onSampleRate(audioContext.sampleRate);
  const frameSamples = Math.max(1, Math.round(audioContext.sampleRate * REALTIME_FRAME_MS / 1000));
  await audioContext.audioWorklet.addModule("/pcm-worklet.js");
  const source = audioContext.createMediaStreamSource(stream);
  const node = new AudioWorkletNode(audioContext, "meetly-pcm-worklet", {
    processorOptions: { frameSamples },
  });
  const mute = audioContext.createGain();
  mute.gain.value = 0;

  node.port.onmessage = (event: MessageEvent<ArrayBuffer>) => {
    const frame = new Float32Array(event.data);
    if (frame.length !== frameSamples) {
      debugLog(`[mic-rt] unexpected frame samples=${frame.length} expected=${frameSamples}`);
    }
    onFrame(frame);
  };

  source.connect(node);
  node.connect(mute);
  mute.connect(audioContext.destination);

  ctx.micAudioContextRef.current = audioContext;
  ctx.micAudioSourceRef.current = source;
  workletNodeRef.current = node;
  micMuteRef.current = mute;
}

function closeRealtimeMicResources(
  workletNodeRef: MutableRefObject<AudioWorkletNode | null>,
  micMuteRef: MutableRefObject<GainNode | null>
) {
  workletNodeRef.current?.port.close();
  workletNodeRef.current?.disconnect();
  micMuteRef.current?.disconnect();
  workletNodeRef.current = null;
  micMuteRef.current = null;
}

function closeRealtimeSegment(
  state: RealtimeMicState,
  reason: "silence" | "maxlen" | "flush",
  transcribe: (
    pcm: Float32Array,
    startMs: number,
    endMs: number,
    kind: "partial" | "final"
  ) => Promise<TranscriptSegment | null>
) {
  const speechMs = state.speechMs;
  const pcm = concatRealtimeFrames(state.segment);
  const startMs = state.segmentStartMs;
  const endMs = Math.round(state.lastSpeechMs);

  state.inSpeech = false;
  state.silenceMs = 0;
  state.speechMs = 0;
  state.lastPartialAtMs = 0;
  state.segment = [];
  state.preRoll = [];
  state.preRollMsHeld = 0;

  if (speechMs < REALTIME_MIN_SPEECH_MS || pcm.length === 0) {
    debugLog(`[mic-rt] segment dropped reason=${reason} speech_ms=${Math.round(speechMs)}`);
    return;
  }

  debugLog(`[mic-rt] segment final reason=${reason} start_ms=${startMs} end_ms=${endMs} samples=${pcm.length}`);
  void transcribe(pcm, startMs, endMs, "final");
}

function concatRealtimeFrames(frames: RealtimeFrame[]) {
  const total = frames.reduce((sum, frame) => sum + frame.pcm.length, 0);
  const out = new Float32Array(total);
  let offset = 0;
  for (const frame of frames) {
    out.set(frame.pcm, offset);
    offset += frame.pcm.length;
  }
  return out;
}

function calculateFloatRms(frame: Float32Array) {
  if (frame.length === 0) return 0;
  let sum = 0;
  for (let index = 0; index < frame.length; index += 1) {
    sum += frame[index] * frame[index];
  }
  return Math.sqrt(sum / frame.length);
}

function encodeWavDataUrl(pcm: Float32Array, sampleRate: number) {
  const wav = encodeWav(pcm, sampleRate);
  return `data:audio/wav;base64,${uint8ToBase64(wav)}`;
}

function encodeWav(pcm: Float32Array, sampleRate: number) {
  const bytesPerSample = 2;
  const dataSize = pcm.length * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * bytesPerSample, true);
  view.setUint16(32, bytesPerSample, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, "data");
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (let index = 0; index < pcm.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, pcm[index]));
    view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
    offset += 2;
  }

  return new Uint8Array(buffer);
}

function writeAscii(view: DataView, offset: number, value: string) {
  for (let index = 0; index < value.length; index += 1) {
    view.setUint8(offset + index, value.charCodeAt(index));
  }
}

function uint8ToBase64(bytes: Uint8Array) {
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.subarray(index, index + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

function previewText(text: string) {
  return text.slice(0, 160).replace(/\n/g, " ");
}

export type MicMeetingActions = ReturnType<typeof useMicMeeting>;
