import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useEffect, useReducer, useRef, useState } from "react";
import { blobToBase64, debugLog, isTauriRuntime } from "../platform";
import { startMicrophoneClip, type MicrophoneClipSession } from "../microphoneClip";
import type { AssistantSuggestion } from "../types";
import type { VoiceAskShortcutPressed, VoiceAskShortcutReleased } from "./types";
import { INITIAL_VOICE_ASK_STATE, voiceAskReducer } from "./voiceAskReducer";

const MIN_RECORDING_MS = 250;
const CANCELLED_STATE_MS = 1_000;

export function useVoiceAsk() {
  const [state, dispatch] = useReducer(voiceAskReducer, INITIAL_VOICE_ASK_STATE);
  const [audioLevel, setAudioLevel] = useState(0);
  const currentRunRef = useRef<string | null>(null);
  const clipSessionRef = useRef<MicrophoneClipSession | null>(null);
  const pendingReleaseRef = useRef(false);
  const cancelledRef = useRef(false);
  const resetTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (!isTauriRuntime()) return;

    let disposed = false;
    const unlisteners: Array<() => void> = [];

    const register = async () => {
      const registered = [
        await listen<VoiceAskShortcutPressed>("voice_ask_pressed", (event) => {
          void startRun(event.payload);
        }),
        await listen<VoiceAskShortcutReleased>("voice_ask_released", (event) => {
          releaseRun(event.payload);
        }),
        await listen<string>("voice_ask_cancel_requested", (event) => {
          void cancelRun(event.payload);
        }),
        await listen<string>("voice_ask_superseded", (event) => {
          supersedeRun(event.payload);
        }),
      ];
      if (disposed) {
        registered.forEach((unlisten) => unlisten());
        return;
      }
      unlisteners.push(...registered);
    };

    void register();
    return () => {
      disposed = true;
      unlisteners.forEach((unlisten) => unlisten());
      cleanupMedia();
      if (resetTimerRef.current !== null) window.clearTimeout(resetTimerRef.current);
    };
  }, []);

  const cleanupMedia = () => {
    clipSessionRef.current?.cancel();
    clipSessionRef.current = null;
    setAudioLevel(0);
  };

  const scheduleReset = () => {
    if (resetTimerRef.current !== null) window.clearTimeout(resetTimerRef.current);
    resetTimerRef.current = window.setTimeout(() => {
      dispatch({ type: "reset" });
    }, CANCELLED_STATE_MS);
  };

  const startRun = async ({ runId }: VoiceAskShortcutPressed) => {
    if (currentRunRef.current) return;
    if (resetTimerRef.current !== null) window.clearTimeout(resetTimerRef.current);

    currentRunRef.current = runId;
    pendingReleaseRef.current = false;
    cancelledRef.current = false;
    dispatch({ type: "start", runId });

    try {
      const clipSession = await startMicrophoneClip({ onLevel: setAudioLevel });
      if (currentRunRef.current !== runId || cancelledRef.current) {
        clipSession.cancel();
        return;
      }

      clipSessionRef.current = clipSession;
      dispatch({
        type: "phase",
        runId,
        phase: "recording",
        message: "松开 Fn 即可提问",
      });
      debugLog(`[voice-ask] recording start run=${runId}`);

      if (pendingReleaseRef.current) stopRecorder(runId);
    } catch (error) {
      await failRun(runId, `麦克风不可用：${errorMessage(error)}`);
    }
  };

  const releaseRun = ({ runId }: VoiceAskShortcutReleased) => {
    if (currentRunRef.current !== runId || cancelledRef.current) return;
    if (!clipSessionRef.current) {
      pendingReleaseRef.current = true;
      return;
    }
    stopRecorder(runId);
  };

  const stopRecorder = (runId: string) => {
    if (currentRunRef.current !== runId) return;
    const session = clipSessionRef.current;
    if (!session) return;
    clipSessionRef.current = null;
    setAudioLevel(0);
    void session
      .stop()
      .then((blob) => processRecording(runId, session.mimeType, session.startedAt, blob))
      .catch((error) => void failRun(runId, `录音失败：${errorMessage(error)}`));
  };

  const processRecording = async (
    runId: string,
    mimeType: string,
    startedAt: number,
    blob: Blob
  ) => {
    if (cancelledRef.current || currentRunRef.current !== runId) return;
    if (Date.now() - startedAt < MIN_RECORDING_MS || blob.size === 0) {
      await cancelRun(runId);
      return;
    }

    try {
      dispatch({ type: "phase", runId, phase: "transcribing", message: "正在理解问题" });
      const audioBase64 = await blobToBase64(blob);
      const question = (
        await invoke<string>("transcribe_audio", { audioBase64, mimeType })
      ).trim();
      assertCurrent(runId);
      if (!question) throw new Error("没有识别到可用问题。");

      dispatch({ type: "question", runId, question });
      dispatch({ type: "phase", runId, phase: "thinking", message: "Thinking..." });
      debugLog(`[voice-ask] transcribed run=${runId} chars=${question.length}`);

      const suggestion = await invoke<AssistantSuggestion>(
        "complete_assistant_with_question",
        { mode: "general", question }
      );
      assertCurrent(runId);
      await finishRun(runId);
      dispatch({ type: "answered", runId, suggestion });
      debugLog(`[voice-ask] answered run=${runId} chars=${suggestion.answer.length}`);
    } catch (error) {
      if (cancelledRef.current || currentRunRef.current !== runId) return;
      await failRun(runId, `语音提问失败：${errorMessage(error)}`);
    }
  };

  const finishRun = async (runId: string) => {
    cleanupMedia();
    await invoke("finish_voice_ask_run", { runId }).catch(() => undefined);
    if (currentRunRef.current === runId) currentRunRef.current = null;
  };

  const failRun = async (runId: string, message: string) => {
    if (currentRunRef.current !== runId) return;
    await finishRun(runId);
    dispatch({ type: "failed", runId, message });
    debugLog(`[voice-ask] failed run=${runId} message=${message}`);
  };

  const cancelRun = async (runId: string) => {
    if (currentRunRef.current !== runId) return;
    cancelledRef.current = true;
    cleanupMedia();
    await invoke("cancel_voice_ask_run", { runId }).catch(() => undefined);
    if (currentRunRef.current === runId) currentRunRef.current = null;
    dispatch({ type: "cancelled", runId });
    scheduleReset();
    debugLog(`[voice-ask] cancelled run=${runId}`);
  };

  const supersedeRun = (runId: string) => {
    if (currentRunRef.current !== runId) return;
    cancelledRef.current = true;
    cleanupMedia();
    currentRunRef.current = null;
    dispatch({ type: "reset" });
    debugLog(`[voice-ask] superseded by dictation run=${runId}`);
  };

  const assertCurrent = (runId: string) => {
    if (cancelledRef.current || currentRunRef.current !== runId) {
      throw new Error("Voice Ask run was cancelled.");
    }
  };

  const close = () => {
    const runId = currentRunRef.current;
    if (runId) {
      void cancelRun(runId);
      return;
    }
    dispatch({ type: "reset" });
  };

  return { state, audioLevel, close };
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
