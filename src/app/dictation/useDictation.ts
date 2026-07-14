import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useEffect, useReducer, useRef, useState } from "react";
import { blobToBase64, debugLog, isTauriRuntime } from "../platform";
import { startMicrophoneClip, type MicrophoneClipSession } from "../microphoneClip";
import { dictationReducer, INITIAL_DICTATION_STATE } from "./dictationReducer";
import { chooseDictationOutput } from "./output";
import type {
  DictationBlocked,
  DictationOutputResult,
  DictationSettings,
  DictationShortcutPressed,
  DictationShortcutReleased,
} from "./types";
import { DEFAULT_DICTATION_SETTINGS } from "./types";

const MIN_RECORDING_MS = 250;
const TERMINAL_STATE_MS = 1_800;

export function useDictation() {
  const [state, dispatch] = useReducer(dictationReducer, INITIAL_DICTATION_STATE);
  const [audioLevel, setAudioLevel] = useState(0);
  const settingsRef = useRef<DictationSettings>(DEFAULT_DICTATION_SETTINGS);
  const currentRunRef = useRef<string | null>(null);
  const clipSessionRef = useRef<MicrophoneClipSession | null>(null);
  const startedAtRef = useRef(0);
  const pendingReleaseRef = useRef(false);
  const cancelledRef = useRef(false);
  const resetTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (!isTauriRuntime()) {
      return;
    }

    let disposed = false;
    const unlisteners: Array<() => void> = [];

    void invoke<DictationSettings>("get_dictation_settings").then((settings) => {
      if (!disposed) settingsRef.current = settings;
    });

    const register = async () => {
      const registered = [
        await listen<DictationShortcutPressed>("dictation_shortcut_pressed", (event) => {
          void startRun(event.payload);
        }),
        await listen<DictationShortcutReleased>("dictation_shortcut_released", (event) => {
          releaseRun(event.payload);
        }),
        await listen<string>("dictation_cancel_requested", (event) => {
          void cancelRun(event.payload);
        }),
        await listen<DictationBlocked>("dictation_blocked", (event) => {
          showBlocked(event.payload.message);
        }),
        await listen<DictationSettings>("dictation_settings_changed", (event) => {
          settingsRef.current = event.payload;
        })
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

  const scheduleReset = (runId?: string) => {
    if (runId && currentRunRef.current === runId) currentRunRef.current = null;
    if (resetTimerRef.current !== null) window.clearTimeout(resetTimerRef.current);
    resetTimerRef.current = window.setTimeout(() => {
      dispatch({ type: "reset", runId });
      if (!runId || currentRunRef.current === runId) currentRunRef.current = null;
    }, TERMINAL_STATE_MS);
  };

  const cleanupMedia = () => {
    clipSessionRef.current?.cancel();
    clipSessionRef.current = null;
    setAudioLevel(0);
  };

  const startRun = async ({ runId }: DictationShortcutPressed) => {
    if (currentRunRef.current) {
      return;
    }

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
      startedAtRef.current = clipSession.startedAt;
      dispatch({ type: "phase", runId, phase: "recording", message: "再次按下即可转写" });
      debugLog(`[dictation] recording start run=${runId}`);

      if (pendingReleaseRef.current) {
        stopRecorder(runId);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await finishRun(runId);
      dispatch({ type: "failed", runId, message: `麦克风不可用：${message}` });
      scheduleReset(runId);
    }
  };

  const releaseRun = ({ runId }: DictationShortcutReleased) => {
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
      .then((blob) => processRecording(runId, session.mimeType, blob))
      .catch((error) => {
        void handleRecordingError(runId, error);
      });
  };

  const processRecording = async (runId: string, mimeType: string, blob: Blob) => {
    const durationMs = Date.now() - startedAtRef.current;

    if (cancelledRef.current || currentRunRef.current !== runId) {
      return;
    }

    if (durationMs < MIN_RECORDING_MS || blob.size === 0) {
      await finishRun(runId);
      dispatch({ type: "cancelled", runId });
      scheduleReset(runId);
      return;
    }

    try {
      dispatch({ type: "phase", runId, phase: "transcribing", message: "正在转写" });
      const sttStartedAt = performance.now();
      const audioBase64 = await blobToBase64(blob);
      const rawText = (
        await invoke<string>("transcribe_audio", { audioBase64, mimeType })
      ).trim();
      debugLog(
        `[dictation] stt complete run=${runId} duration_ms=${Math.round(performance.now() - sttStartedAt)} chars=${rawText.length}`
      );
      assertCurrent(runId);
      if (!rawText) throw new Error("没有识别到可用文本。");
      dispatch({ type: "transcribed", runId, rawText });

      let finalText = rawText;
      if (settingsRef.current.aiPolishEnabled) {
        dispatch({ type: "phase", runId, phase: "polishing", message: "AI 正在整理表达" });
        const polishStartedAt = performance.now();
        try {
          const polishedText = await invoke<string>("polish_dictation", { runId, rawText });
          finalText = chooseDictationOutput(rawText, polishedText);
          debugLog(
            `[dictation] polish complete run=${runId} duration_ms=${Math.round(performance.now() - polishStartedAt)} chars=${finalText.length}`
          );
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          finalText = chooseDictationOutput(rawText);
          debugLog(
            `[dictation] polish fallback run=${runId} duration_ms=${Math.round(performance.now() - polishStartedAt)} reason=${message}`
          );
        }
      }

      assertCurrent(runId);
      dispatch({ type: "phase", runId, phase: "pasting", message: "正在写入输入框" });
      const pasteStartedAt = performance.now();
      try {
        const output = await invoke<DictationOutputResult>("paste_dictation_text", {
          runId,
          text: finalText,
          autoPaste: settingsRef.current.autoPasteEnabled,
          keepResultInClipboard: settingsRef.current.keepResultInClipboard,
        });
        if (cancelledRef.current || currentRunRef.current !== runId) return;
        dispatch({
          type: "finished",
          runId,
          phase: output.pasted ? "completed" : "copied",
          finalText,
          message: output.pasted ? "已粘贴" : "已复制，请手动粘贴",
        });
        debugLog(
          `[dictation] output complete run=${runId} duration_ms=${Math.round(performance.now() - pasteStartedAt)} pasted=${output.pasted} copied=${output.copied}`
        );
      } catch (error) {
        if (cancelledRef.current || currentRunRef.current !== runId) return;
        const message = error instanceof Error ? error.message : String(error);
        debugLog(
          `[dictation] output fallback run=${runId} duration_ms=${Math.round(performance.now() - pasteStartedAt)} reason=${message}`
        );
        dispatch({
          type: "finished",
          runId,
          phase: "copied",
          finalText,
          message: message.includes("copied") ? "已复制，请手动粘贴" : `输出失败：${message}`,
        });
        await finishRun(runId);
      }
      debugLog(`[dictation] complete run=${runId} chars=${finalText.length}`);
      scheduleReset(runId);
    } catch (error) {
      if (cancelledRef.current || currentRunRef.current !== runId) return;
      const message = error instanceof Error ? error.message : String(error);
      await finishRun(runId);
      dispatch({ type: "failed", runId, message: `语音输入失败：${message}` });
      scheduleReset(runId);
    }
  };

  const handleRecordingError = async (runId: string, error: unknown) => {
    if (cancelledRef.current || currentRunRef.current !== runId) return;
    const message = error instanceof Error ? error.message : String(error);
    await finishRun(runId);
    dispatch({ type: "failed", runId, message: `录音失败：${message}` });
    scheduleReset(runId);
  };

  const cancelRun = async (runId: string) => {
    if (currentRunRef.current !== runId) return;
    cancelledRef.current = true;
    cleanupMedia();
    await invoke("cancel_dictation_run", { runId }).catch(() => undefined);
    dispatch({ type: "cancelled", runId });
    debugLog(`[dictation] cancelled run=${runId}`);
    scheduleReset(runId);
  };

  const finishRun = async (runId: string) => {
    cleanupMedia();
    await invoke("finish_dictation_run", { runId }).catch(() => undefined);
  };

  const assertCurrent = (runId: string) => {
    if (cancelledRef.current || currentRunRef.current !== runId) {
      throw new Error("Dictation run was cancelled.");
    }
  };

  const showBlocked = (message: string) => {
    dispatch({ type: "blocked", message });
    scheduleReset();
  };

  const cancel = () => {
    const runId = currentRunRef.current;
    if (runId) void cancelRun(runId);
  };

  const finishRecording = () => {
    const runId = currentRunRef.current;
    if (!runId || cancelledRef.current) return;
    if (!clipSessionRef.current) {
      pendingReleaseRef.current = true;
      return;
    }
    stopRecorder(runId);
  };

  return { state, audioLevel, cancel, finishRecording };
}
