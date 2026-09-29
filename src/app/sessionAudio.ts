export type SessionKind = "remote" | "in_person";
export type AudioSource = "system" | "microphone";

export const resolveAudioSourceForSessionChange = (
  kind: SessionKind,
  _currentSource: AudioSource,
): AudioSource => (kind === "remote" ? "system" : "microphone");
