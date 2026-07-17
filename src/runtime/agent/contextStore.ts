import type {
  AudioSource,
  ContextDocument,
  MeetingPerspective,
  SessionKind,
  TranscriptSegment,
} from "../../app/types";

const MAX_TRANSCRIPT_AGE_MS = 180_000;

export type ContextSnapshot = {
  documents: ContextDocument[];
  recentTranscript: TranscriptSegment[];
  latestSegment: TranscriptSegment | null;
  perspective: MeetingPerspective;
  sessionKind: SessionKind;
  audioSource: AudioSource;
  goal: string;
  sessionId: string | null;
};

export class ContextStore {
  private documents: ContextDocument[] = [];
  private perspective: MeetingPerspective = "candidate";
  private sessionKind: SessionKind = "remote";
  private audioSource: AudioSource = "system";
  private goal = "";
  private sessionId: string | null = null;
  private segments: TranscriptSegment[] = [];

  clear() {
    this.segments = [];
  }

  setDocuments(documents: ContextDocument[]) {
    this.documents = documents;
  }

  setPerspective(perspective: MeetingPerspective) {
    this.perspective = perspective;
  }

  setSessionConfig(config: { kind: SessionKind; audioSource: AudioSource; goal: string }) {
    this.sessionKind = config.kind;
    this.audioSource = config.audioSource;
    this.goal = config.goal.trim();
  }

  setSessionId(sessionId: string | null) {
    this.sessionId = sessionId;
  }

  pushTranscript(segment: TranscriptSegment) {
    this.segments = [...this.segments, segment].sort((left, right) => left.endMs - right.endMs);
    this.evictOldSegments(MAX_TRANSCRIPT_AGE_MS);
  }

  snapshot(windowMs: number): ContextSnapshot {
    const latest = this.segments[this.segments.length - 1] ?? null;
    if (!latest) {
      return {
        documents: this.documents,
        latestSegment: null,
        perspective: this.perspective,
        sessionKind: this.sessionKind,
        audioSource: this.audioSource,
        goal: this.goal,
        recentTranscript: [],
        sessionId: this.sessionId,
      };
    }

    return {
      documents: this.documents,
      latestSegment: latest,
      perspective: this.perspective,
      sessionKind: this.sessionKind,
      audioSource: this.audioSource,
      goal: this.goal,
      recentTranscript: this.segments.filter(
        (segment) => latest.endMs - segment.endMs <= windowMs
      ),
      sessionId: this.sessionId,
    };
  }

  private evictOldSegments(maxAgeMs: number) {
    const latest = this.segments[this.segments.length - 1];
    if (!latest) return;

    this.segments = this.segments.filter(
      (segment) => latest.endMs - segment.endMs <= maxAgeMs
    );
  }
}
