import type { AudioSource, SessionKind } from "./types";

export function resolveAudioSourceForSessionChange(
  kind: SessionKind,
  _currentSource: AudioSource
): AudioSource {
  return kind === "remote" ? "system" : "microphone";
}
