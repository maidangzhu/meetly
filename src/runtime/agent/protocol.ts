import type { AudioSource, SessionKind } from "../../app/types";

export const COACH_JOURNAL_SCHEMA_VERSION = 1 as const;

export type CoachEventType =
  | "session.started"
  | "audio.capture.started"
  | "audio.capture.failed"
  | "transcript.finalized"
  | "speaker.turn.completed"
  | "silence.elapsed"
  | "user.manual_ask"
  | "session.ended";

export type CoachEventSource = AudioSource | "ui" | "runtime";
export type CoachEventSpeaker = "user" | "other" | "unknown";
export type CoachJournalStatus =
  | "observed"
  | "ignored"
  | "running"
  | "spoken"
  | "silent"
  | "failed"
  | "superseded";

export type CoachIgnoreReason =
  | "no_active_session"
  | "capture_not_ready"
  | "no_new_evidence"
  | "duplicate_evidence"
  | "signal_cooldown"
  | "lower_priority_in_flight"
  | "user_run_active"
  | "session_ended";

export type CoachFailureReason =
  | "capture_start_failed"
  | "request_timeout"
  | "run_failed";

export type CoachSupersedeReason =
  | "superseded_by_user"
  | "superseded_by_session";

export type CoachJournalDetail = string | number | boolean | null;

export type CoachEvent = {
  id: string;
  sessionId: string;
  type: CoachEventType;
  occurredAtMs: number;
  source?: CoachEventSource;
  segmentId?: string;
  speaker?: CoachEventSpeaker;
  evidencePreview?: string;
  details?: Record<string, CoachJournalDetail>;
};

export type CoachEventJournalEntry = {
  schemaVersion: typeof COACH_JOURNAL_SCHEMA_VERSION;
  recordType: "event";
  entryId: string;
  recordedAtMs: number;
  sessionId: string;
  status: "observed";
  event: CoachEvent;
};

export type CoachTransitionJournalEntry = {
  schemaVersion: typeof COACH_JOURNAL_SCHEMA_VERSION;
  recordType: "transition";
  entryId: string;
  recordedAtMs: number;
  sessionId: string;
  status: Exclude<CoachJournalStatus, "observed">;
  reason: string;
  wakeId?: string;
  runId?: string;
  eventIds: string[];
  details?: Record<string, CoachJournalDetail>;
};

export type CoachJournalEntry = CoachEventJournalEntry | CoachTransitionJournalEntry;

export type SessionStartedEventDetails = {
  sessionKind: SessionKind;
  audioSource: AudioSource;
  hasDocuments: boolean;
};

export type CoachSignalKind =
  | "question_detected"
  | "objection_raised"
  | "commitment_detected"
  | "decision_window"
  | "goal_drift"
  | "unresolved_topic"
  | "user_stalled"
  | "answer_drift"
  | "fresh_context";

export type CoachSignal = {
  id: string;
  sessionId: string;
  kind: CoachSignalKind;
  priority: 1 | 2 | 3;
  evidenceEventIds: string[];
  evidenceKey: string;
  createdAtMs: number;
};

export type CoachWakeKind = "proactive" | "user";

export type CoachWake = {
  id: string;
  sessionId: string;
  kind: CoachWakeKind;
  priority: 0 | 1 | 2 | 3;
  reason: string;
  evidenceEventIds: string[];
  evidenceKey: string;
  createdAtMs: number;
};

export type CoachRunOutcome =
  | { type: "spoken" }
  | { type: "silent" }
  | { type: "failed"; reason: CoachFailureReason }
  | { type: "superseded"; reason: CoachSupersedeReason };
