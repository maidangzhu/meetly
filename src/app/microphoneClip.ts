export type MicrophoneClipSession = {
  mimeType: string;
  startedAt: number;
  stop: () => Promise<Blob>;
  cancel: () => void;
};

export async function startMicrophoneClip(): Promise<MicrophoneClipSession> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const mimeType = MediaRecorder.isTypeSupported("audio/webm") ? "audio/webm" : "audio/ogg";
  const recorder = new MediaRecorder(stream, { mimeType });
  const chunks: Blob[] = [];
  let cancelled = false;
  let stopPromise: Promise<Blob> | null = null;

  const cleanup = () => {
    stream.getTracks().forEach((track) => track.stop());
  };

  recorder.ondataavailable = (event) => {
    if (event.data.size > 0) chunks.push(event.data);
  };
  recorder.start(100);

  return {
    mimeType,
    startedAt: Date.now(),
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
          cleanup();
          resolve(new Blob(chunks, { type: mimeType }));
        };
        if (recorder.state === "recording") {
          recorder.stop();
        } else {
          cleanup();
          resolve(new Blob(chunks, { type: mimeType }));
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
