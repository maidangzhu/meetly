import { createId, debugLog, safeInvoke } from "../../app/platform";
import {
  COACH_JOURNAL_SCHEMA_VERSION,
  type CoachEvent,
  type CoachEventJournalEntry,
  type CoachJournalDetail,
  type CoachJournalEntry,
  type CoachTransitionJournalEntry,
} from "./protocol";

const DEFAULT_MAX_ENTRIES = 400;
const MAX_EVIDENCE_PREVIEW_CHARS = 240;
const MAX_DETAIL_STRING_CHARS = 320;
const SENSITIVE_DETAIL_KEY = /(api.?key|authorization|secret|token|password|credential)/i;

export type CoachEventInput = Omit<CoachEvent, "id" | "occurredAtMs"> & {
  id?: string;
  occurredAtMs?: number;
};

export type CoachTransitionInput = Omit<
  CoachTransitionJournalEntry,
  "schemaVersion" | "recordType" | "entryId" | "recordedAtMs"
>;

export type CoachJournalSink = (entry: CoachJournalEntry) => void | Promise<void>;

export class CoachEventJournal {
  private entries: CoachJournalEntry[] = [];

  constructor(
    private readonly maxEntries = DEFAULT_MAX_ENTRIES,
    private readonly sink: CoachJournalSink = persistCoachJournalEntry
  ) {
    if (!Number.isInteger(maxEntries) || maxEntries < 1) {
      throw new Error("CoachEventJournal maxEntries must be a positive integer.");
    }
  }

  appendEvent(input: CoachEventInput) {
    const now = input.occurredAtMs ?? Date.now();
    const event: CoachEvent = {
      ...input,
      id: input.id ?? createId("coach-event"),
      occurredAtMs: now,
      ...(input.evidencePreview
        ? { evidencePreview: truncate(input.evidencePreview, MAX_EVIDENCE_PREVIEW_CHARS) }
        : {}),
      ...(input.details ? { details: sanitizeDetails(input.details) } : {}),
    };
    const entry: CoachEventJournalEntry = {
      schemaVersion: COACH_JOURNAL_SCHEMA_VERSION,
      recordType: "event",
      entryId: createId("coach-log"),
      recordedAtMs: now,
      sessionId: event.sessionId,
      status: "observed",
      event,
    };
    this.append(entry);
    return event;
  }

  appendTransition(input: CoachTransitionInput) {
    const entry: CoachTransitionJournalEntry = {
      ...input,
      schemaVersion: COACH_JOURNAL_SCHEMA_VERSION,
      recordType: "transition",
      entryId: createId("coach-log"),
      recordedAtMs: Date.now(),
      eventIds: [...new Set(input.eventIds)].slice(-20),
      ...(input.details ? { details: sanitizeDetails(input.details) } : {}),
    };
    this.append(entry);
    return entry;
  }

  snapshot() {
    return [...this.entries];
  }

  clear() {
    this.entries = [];
  }

  private append(entry: CoachJournalEntry) {
    this.entries = [...this.entries, entry].slice(-this.maxEntries);
    void Promise.resolve(this.sink(entry)).catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      debugLog(`[coach-journal] persist failed message=${truncate(message, 160)}`);
    });
  }
}
export async function persistCoachJournalEntry(entry: CoachJournalEntry) {
  await safeInvoke("append_coach_event_log", { entry });
}

function sanitizeDetails(details: Record<string, CoachJournalDetail>) {
  return Object.fromEntries(
    Object.entries(details).map(([key, value]) => {
      if (SENSITIVE_DETAIL_KEY.test(key)) return [key, "[REDACTED]"];
      return [key, typeof value === "string" ? truncate(value, MAX_DETAIL_STRING_CHARS) : value];
    })
  );
}

function truncate(value: string, maxChars: number) {
  const normalized = value.replace(/[\r\n]+/g, " ").trim();
  return normalized.length <= maxChars ? normalized : normalized.slice(0, maxChars);
}
