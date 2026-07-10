import type { TranscriptSegment } from "../../app/types";

const MAX_TRANSCRIPT_AGE_MS = 180_000;

export type ContextSnapshot = {
  recentTranscript: TranscriptSegment[];
  latestSegment: TranscriptSegment | null;
};

export class ContextStore {
  private segments: TranscriptSegment[] = [];

  clear() {
    this.segments = [];
  }

  pushTranscript(segment: TranscriptSegment) {
    this.segments = [...this.segments, segment].sort((left, right) => left.endMs - right.endMs);
    this.evictOldSegments(MAX_TRANSCRIPT_AGE_MS);
  }

  snapshot(windowMs: number): ContextSnapshot {
    const latest = this.segments[this.segments.length - 1] ?? null;
    if (!latest) {
      return {
        latestSegment: null,
        recentTranscript: [],
      };
    }

    return {
      latestSegment: latest,
      recentTranscript: this.segments.filter(
        (segment) => latest.endMs - segment.endMs <= windowMs
      ),
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
