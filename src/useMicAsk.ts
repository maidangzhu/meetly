import { invoke } from "@tauri-apps/api/core";
import { useCallback, useRef, useState } from "react";

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

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);

  const cleanupStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    mediaRecorderRef.current = null;
  }, []);

  const startRecording = useCallback(async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      chunksRef.current = [];

      const mimeType = MediaRecorder.isTypeSupported("audio/webm")
        ? "audio/webm"
        : "audio/ogg";
      const recorder = new MediaRecorder(stream, { mimeType });
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };

      recorder.start(100);
      setState("recording");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(`Microphone access failed: ${message}`);
      cleanupStream();
      setState("idle");
    }
  }, [cleanupStream]);

  const stopAndAsk = useCallback(async () => {
    const recorder = mediaRecorderRef.current;
    if (!recorder || recorder.state !== "recording") {
      return;
    }

    const mimeType = recorder.mimeType;

    const stopped = new Promise<void>((resolve) => {
      recorder.onstop = () => resolve();
    });
    recorder.stop();
    await stopped;

    const chunks = [...chunksRef.current];
    cleanupStream();

    if (chunks.length === 0) {
      setError("No audio captured.");
      setState("idle");
      return;
    }

    setState("transcribing");
    try {
      const blob = new Blob(chunks, { type: mimeType });
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
    mediaRecorderRef.current?.stop();
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
