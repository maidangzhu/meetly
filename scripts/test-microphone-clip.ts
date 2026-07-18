import assert from "node:assert/strict";
import {
  MICROPHONE_AUDIO_CONSTRAINTS,
  MICROPHONE_CLIP_TIMESLICE_MS,
  startMicrophoneClip,
} from "../src/app/microphoneClip";

class FakeMediaRecorder {
  static lastInstance: FakeMediaRecorder | null = null;

  static isTypeSupported(mimeType: string) {
    return mimeType === "audio/mp4;codecs=mp4a.40.2";
  }

  mimeType: string;
  state: RecordingState = "inactive";
  ondataavailable: ((event: BlobEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onstop: ((event: Event) => void) | null = null;
  timeslice: number | undefined;

  constructor(_stream: MediaStream, options?: MediaRecorderOptions) {
    this.mimeType = options?.mimeType ?? "audio/mp4";
    FakeMediaRecorder.lastInstance = this;
  }

  start(timeslice?: number) {
    this.timeslice = timeslice;
    this.state = "recording";
  }

  emit(data: Blob) {
    this.ondataavailable?.({ data } as BlobEvent);
  }

  stop() {
    this.state = "inactive";
    this.emit(new Blob([Uint8Array.of(0xff)], { type: this.mimeType }));
    this.onstop?.(new Event("stop"));
  }
}

let trackStopped = false;
let requestedConstraints: MediaStreamConstraints | undefined;
const track = {
  label: "MacBook Pro Microphone",
  getSettings: () => ({
    echoCancellation: false,
    noiseSuppression: false,
    autoGainControl: false,
  }),
  stop: () => { trackStopped = true; },
};
const stream = {
  getAudioTracks: () => [track],
  getTracks: () => [track],
} as unknown as MediaStream;

Object.defineProperty(globalThis, "MediaRecorder", {
  configurable: true,
  value: FakeMediaRecorder,
});
Object.defineProperty(globalThis, "navigator", {
  configurable: true,
  value: {
    mediaDevices: {
      getUserMedia: async (constraints: MediaStreamConstraints) => {
        requestedConstraints = constraints;
        return stream;
      },
    },
  },
});
Object.defineProperty(globalThis, "window", {
  configurable: true,
  value: { AudioContext: undefined },
});

const session = await startMicrophoneClip();
assert.deepEqual(requestedConstraints, { audio: MICROPHONE_AUDIO_CONSTRAINTS });
assert.equal(MICROPHONE_AUDIO_CONSTRAINTS.echoCancellation, false);
assert.equal(MICROPHONE_AUDIO_CONSTRAINTS.noiseSuppression, false);
assert.equal(MICROPHONE_AUDIO_CONSTRAINTS.autoGainControl, false);
const recorder = FakeMediaRecorder.lastInstance;
assert.ok(recorder);
assert.equal(recorder.timeslice, MICROPHONE_CLIP_TIMESLICE_MS);
assert.equal(session.mimeType, "audio/mp4;codecs=mp4a.40.2");

// One event per second models the maximum supported three-minute clip.
for (let second = 0; second < 180; second += 1) {
  recorder.emit(new Blob([Uint8Array.of(second % 256)], { type: session.mimeType }));
}

const blob = await session.stop();
assert.equal(blob.size, 181);
assert.equal(blob.type, session.mimeType);
assert.equal(trackStopped, true);

const bytes = new Uint8Array(await blob.arrayBuffer());
assert.equal(bytes[0], 0);
assert.equal(bytes[179], 179);
assert.equal(bytes[180], 0xff);

console.log("microphone clip 3-minute chunk retention checks passed");
