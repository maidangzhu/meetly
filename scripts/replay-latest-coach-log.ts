import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

type ParsedEvent =
  | {
      ts: number;
      kind: "session_start";
      sessionId: string;
      raw: string;
    }
  | {
      ts: number;
      kind: "session_stop";
      sessionId: string;
      raw: string;
    }
  | {
      ts: number;
      kind: "transcript";
      index: number | null;
      text: string;
      raw: string;
    }
  | {
      ts: number;
      kind: "coach_start";
      trigger: string;
      signal: string;
      reason: string;
      raw: string;
    }
  | {
      ts: number;
      kind: "coach_silent";
      trigger: string;
      signal: string;
      reason: string;
      raw: string;
    }
  | {
      ts: number;
      kind: "coach_message";
      trigger: string;
      text: string;
      raw: string;
    }
  | {
      ts: number;
      kind: "coach_error";
      message: string;
      raw: string;
    }
  | {
      ts: number;
      kind: "coach_skipped";
      reason: string;
      raw: string;
    }
  | {
      ts: number;
      kind: "ask_submit";
      raw: string;
    }
  | {
      ts: number;
      kind: "report_start";
      transcriptCount: number | null;
      askCount: number | null;
      coachCount: number | null;
      raw: string;
    }
  | {
      ts: number;
      kind: "other";
      raw: string;
    };

const logPath = process.argv[2] ?? join(homedir(), ".meetly", "debug.log");

function main() {
  if (!existsSync(logPath)) {
    throw new Error(`debug log not found: ${logPath}`);
  }

  const lines = readFileSync(logPath, "utf8").split(/\r?\n/).filter(Boolean);
  const latestStartIndex = findLatestSessionStart(lines);
  if (latestStartIndex < 0) {
    throw new Error("no session start found in debug log");
  }

  const events = lines.slice(latestStartIndex).map(parseLine);
  const start = events.find((event): event is Extract<ParsedEvent, { kind: "session_start" }> => event.kind === "session_start");
  if (!start) {
    throw new Error("latest session start parse failed");
  }

  const transcripts = events.filter((event): event is Extract<ParsedEvent, { kind: "transcript" }> => event.kind === "transcript");
  const coachStarts = events.filter((event): event is Extract<ParsedEvent, { kind: "coach_start" }> => event.kind === "coach_start");
  const coachSilents = events.filter((event): event is Extract<ParsedEvent, { kind: "coach_silent" }> => event.kind === "coach_silent");
  const coachMessages = events.filter((event): event is Extract<ParsedEvent, { kind: "coach_message" }> => event.kind === "coach_message");
  const coachErrors = events.filter((event): event is Extract<ParsedEvent, { kind: "coach_error" }> => event.kind === "coach_error");
  const coachSkipped = events.filter((event): event is Extract<ParsedEvent, { kind: "coach_skipped" }> => event.kind === "coach_skipped");
  const askSubmits = events.filter((event) => event.kind === "ask_submit");
  const report = events.find((event): event is Extract<ParsedEvent, { kind: "report_start" }> => event.kind === "report_start");
  const transcriptUpdateStarts = coachStarts.filter(
    (event) => event.trigger === "heartbeat" && event.signal === "fresh_context" && event.reason === "transcript_update"
  );
  const heartbeatRepeatStarts = coachStarts.filter(
    (event) => event.trigger === "heartbeat" && event.signal === "fresh_context" && event.reason.startsWith("heartbeat_observe")
  );
  const manualStarts = coachStarts.filter((event) => event.trigger === "manual_ask_done");

  console.log(`log=${logPath}`);
  console.log(`session=${start.sessionId}`);
  console.log(
    [
      `transcripts=${transcripts.length}`,
      `coach_start=${coachStarts.length}`,
      `coach_start_transcript_update=${transcriptUpdateStarts.length}`,
      `coach_start_heartbeat_repeat=${heartbeatRepeatStarts.length}`,
      `coach_start_manual=${manualStarts.length}`,
      `coach_silent=${coachSilents.length}`,
      `coach_message=${coachMessages.length}`,
      `coach_error=${coachErrors.length}`,
      `coach_skipped=${coachSkipped.length}`,
      `ask_submit=${askSubmits.length}`,
      report ? `report_coach=${report.coachCount ?? "unknown"}` : "report_coach=missing",
    ].join(" ")
  );

  console.log("\nrecent transcript -> coach result:");
  for (const transcript of transcripts.slice(-16)) {
    const nextCoach = events.find(
      (event) =>
        event.ts >= transcript.ts &&
        (event.kind === "coach_silent" || event.kind === "coach_message" || event.kind === "coach_error")
    );
    const result =
      nextCoach?.kind === "coach_silent"
        ? `silent reason=${nextCoach.reason}`
        : nextCoach?.kind === "coach_message"
          ? `message text=${nextCoach.text.slice(0, 80)}`
          : nextCoach?.kind === "coach_error"
            ? `error message=${nextCoach.message}`
            : "no_result";
    console.log(`- ${formatMs(transcript.ts - start.ts)} index=${transcript.index ?? "?"} text=${transcript.text} => ${result}`);
  }

  const failures: string[] = [];
  if (transcripts.length === 0) failures.push("no_transcript_events");
  if (coachStarts.length === 0) failures.push("coach_never_started");
  if (transcriptUpdateStarts.length === 0) failures.push("coach_not_started_on_transcript_update");
  if (coachErrors.length > 0) failures.push("coach_errors_present");
  if (coachSkipped.length > transcripts.length / 2) failures.push("coach_mostly_skipped_in_flight");

  const diagnosis =
    coachStarts.length > 0 && coachSilents.length === coachStarts.length && coachMessages.length === 0
      ? "触发链路是通的；问题在教练模型每次都返回 SILENT。"
      : coachStarts.length === 0
        ? "教练没有被触发。"
        : coachMessages.length > 0
          ? "教练有输出；如果界面没看到，要查渲染。"
          : "教练触发结果不稳定，需要继续看错误/跳过原因。";
  console.log(`\ndiagnosis=${diagnosis}`);

  const summary = {
    passed: failures.length === 0,
    failures,
    triggered: coachStarts.length > 0,
    allSilent: coachStarts.length > 0 && coachSilents.length === coachStarts.length && coachMessages.length === 0,
  };
  console.log(`summary=${JSON.stringify(summary)}`);

  if (failures.length > 0) {
    process.exit(1);
  }
}

function findLatestSessionStart(lines: string[]) {
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (lines[index].includes("[session] start id=")) return index;
  }
  return -1;
}

function parseLine(raw: string): ParsedEvent {
  const timestamp = Number(raw.match(/^(\d+)/)?.[1] ?? 0);
  if (raw.includes("[session] start id=")) {
    return {
      ts: timestamp,
      kind: "session_start",
      sessionId: raw.match(/\[session\] start id=([^\s]+)/)?.[1] ?? "unknown",
      raw,
    };
  }
  if (raw.includes("[session] stop id=")) {
    return {
      ts: timestamp,
      kind: "session_stop",
      sessionId: raw.match(/\[session\] stop id=([^\s]+)/)?.[1] ?? "unknown",
      raw,
    };
  }
  if (raw.includes("[mic] transcript ok")) {
    return {
      ts: timestamp,
      kind: "transcript",
      index: parseOptionalInt(raw.match(/ index=(\d+)/)?.[1]),
      text: raw.match(/ text=(.*)$/)?.[1]?.trim() ?? "",
      raw,
    };
  }
  if (raw.includes("[pi] coach start")) {
    return {
      ts: timestamp,
      kind: "coach_start",
      trigger: raw.match(/ trigger=([^\s]+)/)?.[1] ?? "unknown",
      signal: raw.match(/ signal=([^\s]+)/)?.[1] ?? "unknown",
      reason: raw.match(/ reason=([^\s]+)/)?.[1] ?? "unknown",
      raw,
    };
  }
  if (raw.includes("[pi] coach silent")) {
    return {
      ts: timestamp,
      kind: "coach_silent",
      trigger: raw.match(/ trigger=([^\s]+)/)?.[1] ?? "unknown",
      signal: raw.match(/ signal=([^\s]+)/)?.[1] ?? "unknown",
      reason: raw.match(/ reason=([^\s]+)/)?.[1] ?? "unknown",
      raw,
    };
  }
  if (raw.includes("[pi] coach message")) {
    return {
      ts: timestamp,
      kind: "coach_message",
      trigger: raw.match(/ trigger=([^\s]+)/)?.[1] ?? "unknown",
      text: raw.match(/ text=(.*)$/)?.[1]?.trim() ?? "",
      raw,
    };
  }
  if (raw.includes("[pi] coach error")) {
    return {
      ts: timestamp,
      kind: "coach_error",
      message: raw.match(/ message=(.*)$/)?.[1]?.trim() ?? "",
      raw,
    };
  }
  if (raw.includes("[pi] coach skipped")) {
    return {
      ts: timestamp,
      kind: "coach_skipped",
      reason: raw.match(/ reason=([^\s]+)/)?.[1] ?? "unknown",
      raw,
    };
  }
  if (raw.includes("[ask] submit")) {
    return { ts: timestamp, kind: "ask_submit", raw };
  }
  if (raw.includes("[report] start")) {
    return {
      ts: timestamp,
      kind: "report_start",
      transcriptCount: parseOptionalInt(raw.match(/ transcript=(\d+)/)?.[1]),
      askCount: parseOptionalInt(raw.match(/ asks=(\d+)/)?.[1]),
      coachCount: parseOptionalInt(raw.match(/ coach=(\d+)/)?.[1]),
      raw,
    };
  }
  return { ts: timestamp, kind: "other", raw };
}

function parseOptionalInt(value: string | undefined) {
  if (value === undefined) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatMs(ms: number) {
  return `${Math.round(ms / 1000)}s`;
}

main();
