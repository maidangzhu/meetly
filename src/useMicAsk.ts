import { invoke } from "@tauri-apps/api/core";
import { useCallback, useRef, useState } from "react";
import { startMicrophoneClip, type MicrophoneClipSession } from "./app/microphoneClip";

/**
 * Records a microphone clip via the browser's MediaRecorder (getUserMedia),
 * transcribes it through the STT provider, then asks the LLM for a
 * suggestion using that transcript as the question. This is a separate
 * capture path from system-audio VAD (`start_listening`/`stop_listening`):
 * it records the user's own voice on demand, mirrors pluely-master's
 * `AudioRecorder.tsx`, and is what triggers the macOS microphone privacy
 * indicator (system-audio capture via CoreAudio Process Tap triggers a
 * different, separate privacy indicator).
 */
export type MicAskState = "idle" | "recording" | "transcribing" | "asking";

export function useMicAsk(onQuestion: (question: string) => void) {
  const [state, setState] = useState<MicAskState>("idle");
  const [error, setError] = useState<string | null>(null);

  const sessionRef = useRef<MicrophoneClipSession | null>(null);

  const cleanupStream = useCallback(() => {
    sessionRef.current = null;
  }, []);

  const startRecording = useCallback(async () => {
    setError(null);
    try {
      sessionRef.current = await startMicrophoneClip();
      setState("recording");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(`Microphone access failed: ${message}`);
      cleanupStream();
      setState("idle");
    }
  }, [cleanupStream]);

  const stopAndAsk = useCallback(async () => {
    const session = sessionRef.current;
    if (!session) {
      return;
    }

    const blob = await session.stop();
    const mimeType = session.mimeType;
    cleanupStream();

    if (blob.size === 0) {
      setError("No audio captured.");
      setState("idle");
      return;
    }

    setState("transcribing");
    try {
      const audioBase64 = await blobToBase64(blob);

      const transcription = await invoke<string>("transcribe_audio", {
        audioBase64,
        mimeType,
      });

      const trimmed = transcription.trim();
      if (!trimmed) {
        setError("Transcription came back empty.");
        setState("idle");
        return;
      }

      setState("asking");
      onQuestion(trimmed);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
    } finally {
      setState("idle");
    }
  }, [cleanupStream, onQuestion]);

  const cancel = useCallback(() => {
    sessionRef.current?.cancel();
    cleanupStream();
    setState("idle");
  }, [cleanupStream]);

  return { state, error, startRecording, stopAndAsk, cancel };
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = reader.result;
      if (typeof result === "string") {
        resolve(result);
      } else {
        reject(new Error("Failed to read audio blob as base64"));
      }
    };
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read audio blob"));
    reader.readAsDataURL(blob);
  });
}
