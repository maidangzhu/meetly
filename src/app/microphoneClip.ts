import { debugLog } from "./platform";

export type MicrophoneClipSession = {
  mimeType: string;
  startedAt: number;
  stop: () => Promise<Blob>;
  cancel: () => void;
};

type MicrophoneClipOptions = {
  onLevel?: (level: number) => void;
};

export const MICROPHONE_CLIP_TIMESLICE_MS = 1_000;

const MICROPHONE_MIME_TYPES = [
  "audio/mp4;codecs=mp4a.40.2",
  "audio/mp4",
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/ogg;codecs=opus",
  "audio/ogg",
];

export function getSupportedMicrophoneMimeType() {
  return MICROPHONE_MIME_TYPES.find((candidate) => MediaRecorder.isTypeSupported(candidate)) ?? "";
}

export async function startMicrophoneClip(
  options: MicrophoneClipOptions = {}
): Promise<MicrophoneClipSession> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const mimeType = getSupportedMicrophoneMimeType();
  const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
  const recordingMimeType = recorder.mimeType || mimeType;
  const chunks: Blob[] = [];
  const startedAt = Date.now();
  let cancelled = false;
  let stopPromise: Promise<Blob> | null = null;
  let audioContext: AudioContext | null = null;
  let meterTimer: number | null = null;

  const cleanup = () => {
    if (meterTimer !== null) window.clearInterval(meterTimer);
    meterTimer = null;
    options.onLevel?.(0);
    void audioContext?.close().catch(() => undefined);
    audioContext = null;
    stream.getTracks().forEach((track) => track.stop());
  };

  const finalize = () => {
    cleanup();
    const chunkCount = chunks.length;
    const blob = new Blob(chunks, { type: recordingMimeType });
    chunks.length = 0;
    debugLog(
      `[microphone-clip] finalized duration_ms=${Date.now() - startedAt} chunks=${chunkCount} bytes=${blob.size} mime_type=${recordingMimeType || "default"}`
    );
    return blob;
  };

  const AudioContextCtor = window.AudioContext ??
    (window as Window & typeof globalThis & { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;
  if (AudioContextCtor && options.onLevel) {
    try {
      audioContext = new AudioContextCtor();
      const source = audioContext.createMediaStreamSource(stream);
      const analyser = audioContext.createAnalyser();
      const samples = new Uint8Array(512);
      analyser.fftSize = samples.length;
      analyser.smoothingTimeConstant = 0.72;
      source.connect(analyser);
      meterTimer = window.setInterval(() => {
        analyser.getByteTimeDomainData(samples);
        let sum = 0;
        for (const sample of samples) {
          const normalized = (sample - 128) / 128;
          sum += normalized * normalized;
        }
        options.onLevel?.(Math.min(1, Math.sqrt(sum / samples.length) * 10));
      }, 50);
    } catch {
      void audioContext?.close().catch(() => undefined);
      audioContext = null;
    }
  }

  recorder.ondataavailable = (event) => {
    if (event.data.size > 0) chunks.push(event.data);
  };
  // WKWebView can finalize only its first internal MP4 buffer when a recorder
  // runs without a timeslice. Periodic data events keep long clips complete;
  // the MediaRecorder contract guarantees their combined Blob is playable.
  recorder.start(MICROPHONE_CLIP_TIMESLICE_MS);

  return {
    mimeType: recordingMimeType,
    startedAt,
    stop() {
      if (stopPromise) return stopPromise;
      stopPromise = new Promise<Blob>((resolve, reject) => {
        if (cancelled) {
          reject(new Error("Microphone recording was cancelled."));
          return;
        }
        recorder.onerror = () => {
          cleanup();
          reject(new Error("Microphone recording failed."));
        };
        recorder.onstop = () => {
          resolve(finalize());
        };
        if (recorder.state === "recording") {
          recorder.stop();
        } else {
          resolve(finalize());
        }
      });
      return stopPromise;
    },
    cancel() {
      cancelled = true;
      if (recorder.state === "recording") recorder.stop();
      cleanup();
      chunks.length = 0;
    },
  };
}
