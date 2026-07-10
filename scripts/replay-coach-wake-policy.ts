import {
  createInitialCoachWakeState,
  evaluateHeartbeatWake,
  evaluateTranscriptWake,
  markCoachObserved,
  markCoachWakeStarted,
  type CoachWakeDecision,
  type CoachWakeSignal,
} from "../src/app/coachWakePolicy";
import { buildInterviewAskContext, detectLatestQuestion, detectQuestionCandidateWithContext } from "../src/app/interviewLogic";
import type { QuestionCandidate, TranscriptSegment } from "../src/app/types";

type ReplaySegment = {
  atMs: number;
  durationMs?: number;
  speaker?: TranscriptSegment["speaker"];
  text: string;
};

type ReplayScenario = {
  name: string;
  durationMs: number;
  segments: ReplaySegment[];
  expectedWakeSignals: CoachWakeSignal[];
  visibleSignals?: CoachWakeSignal[];
  allowedExtraSignals?: CoachWakeSignal[];
};

type ReplayEvent = {
  atMs: number;
  source: "transcript" | "heartbeat";
  decision: "wake" | "skip";
  signal: CoachWakeSignal;
  reason: string;
  text?: string;
};

const HEARTBEAT_MS = 10_000;

const scenarios: ReplayScenario[] = [
  {
    name: "clear-technical-question",
    durationMs: 12_000,
    segments: [
      {
        atMs: 0,
        speaker: "interviewer",
        text: "如果线上突然出现延迟很高，你会怎么定位？",
      },
    ],
    expectedWakeSignals: ["new_question"],
    visibleSignals: ["new_question"],
  },
  {
    name: "filler-transcript",
    durationMs: 12_000,
    segments: [
      {
        atMs: 0,
        speaker: "unknown",
        text: "嗯嗯，好的，可以。",
      },
    ],
    expectedWakeSignals: [],
  },
  {
    name: "duplicate-question",
    durationMs: 20_000,
    segments: [
      {
        atMs: 0,
        speaker: "interviewer",
        text: "你能讲一下你做过最复杂的一个项目吗？",
      },
      {
        atMs: 8_000,
        speaker: "interviewer",
        text: "你能讲一下你做过最复杂的一个项目吗？",
      },
    ],
    expectedWakeSignals: ["new_question"],
    visibleSignals: ["new_question"],
  },
  {
    name: "fragmented-question",
    durationMs: 16_000,
    segments: [
      {
        atMs: 0,
        speaker: "unknown",
        text: "说一下。",
      },
      {
        atMs: 1_800,
        speaker: "unknown",
        text: "你对 React。",
      },
      {
        atMs: 3_400,
        speaker: "unknown",
        text: "的理解。",
      },
    ],
    expectedWakeSignals: ["new_question"],
    visibleSignals: ["new_question"],
  },
  {
    name: "setup-then-topic-question",
    durationMs: 16_000,
    segments: [
      {
        atMs: 0,
        speaker: "unknown",
        text: "你好，能听得到吗？说一下。",
      },
      {
        atMs: 3_000,
        speaker: "interviewer",
        text: "React fiber 的原理。",
      },
      {
        atMs: 8_000,
        speaker: "user",
        text: "React fiber 是 React 的一种渲染架构。",
      },
    ],
    expectedWakeSignals: ["new_question"],
    visibleSignals: ["new_question"],
  },
  {
    name: "silence-after-question",
    durationMs: 22_000,
    segments: [
      {
        atMs: 0,
        speaker: "interviewer",
        text: "你怎么看待一个线上故障的定位流程？",
      },
    ],
    expectedWakeSignals: ["new_question", "silence_after_question"],
    visibleSignals: ["silence_after_question"],
  },
  {
    name: "silent-observed-with-answer",
    durationMs: 20_000,
    segments: [
      {
        atMs: 0,
        speaker: "interviewer",
        text: "你会怎么定位线上延迟问题？",
      },
      {
        atMs: 4_000,
        speaker: "user",
        text: "我会先看监控指标和链路追踪，确认是哪一段耗时升高。",
      },
    ],
    expectedWakeSignals: ["new_question"],
    visibleSignals: [],
  },
  {
    name: "long-answer",
    durationMs: 42_000,
    segments: [
      {
        atMs: 0,
        speaker: "interviewer",
        text: "你能讲一下你做过最复杂的一个项目吗？",
      },
      {
        atMs: 4_000,
        durationMs: 5_000,
        speaker: "user",
        text: "这个项目主要是一个实时面试辅助工具，我负责整体链路。",
      },
      {
        atMs: 10_000,
        durationMs: 5_000,
        speaker: "user",
        text: "当时比较复杂的是音频采集、分段、转写和大模型建议之间的协调。",
      },
      {
        atMs: 16_000,
        durationMs: 5_000,
        speaker: "user",
        text: "我还处理了很多状态同步，比如录音不能被按 Enter 打断。",
      },
      {
        atMs: 22_000,
        durationMs: 5_000,
        speaker: "user",
        text: "另外还有很多窗口层面的事情，比如悬浮岛、隐藏模式和点击穿透。",
      },
    ],
    expectedWakeSignals: ["new_question", "long_answer"],
    visibleSignals: ["new_question", "long_answer"],
  },
];

function createSegment(input: ReplaySegment, index: number): TranscriptSegment {
  const durationMs = input.durationMs ?? 1_200;
  return {
    id: `seg-${index}`,
    source: "microphone",
    speaker: input.speaker ?? "unknown",
    text: input.text,
    startMs: input.atMs,
    endMs: input.atMs + durationMs,
  };
}

function runScenario(scenario: ReplayScenario) {
  const state = createInitialCoachWakeState();
  const transcript: TranscriptSegment[] = [];
  const recentCandidates: QuestionCandidate[] = [];
  const events: ReplayEvent[] = [];
  const segments = scenario.segments.map(createSegment);
  const times = new Set<number>();

  for (const segment of segments) times.add(segment.endMs);
  for (let atMs = HEARTBEAT_MS; atMs <= scenario.durationMs; atMs += HEARTBEAT_MS) {
    times.add(atMs);
  }

  for (const now of [...times].sort((left, right) => left - right)) {
    for (const segment of segments.filter((item) => item.endMs === now)) {
      transcript.push(segment);
      const recentTranscript = transcript.filter((item) => segment.endMs - item.endMs <= 120_000);
      const detected = segment.speaker === "user" ? null : detectQuestionCandidateWithContext(segment, recentTranscript);
      const candidate = detected ? { ...detected, createdAt: now } : null;
      const decision = evaluateTranscriptWake({
        now,
        candidate,
        recentCandidates,
        coachInFlight: false,
      });
      recordEvent(events, now, "transcript", decision, segment.text);
      applyDecision(state, transcript, scenario, decision, now);
      if (candidate && !(decision.reason.startsWith("duplicate_question"))) {
        recentCandidates.push(candidate);
      }
    }

    if (now % HEARTBEAT_MS === 0) {
      const decision = evaluateHeartbeatWake({
        now,
        transcript,
        recentCandidates,
        state,
        coachInFlight: false,
      });
      recordEvent(events, now, "heartbeat", decision);
      applyDecision(state, transcript, scenario, decision, now);
    }
  }

  return summarizeScenario(scenario, events);
}

function applyDecision(
  state: ReturnType<typeof createInitialCoachWakeState>,
  transcript: TranscriptSegment[],
  scenario: ReplayScenario,
  decision: CoachWakeDecision,
  now: number
) {
  if (!decision.shouldWake) return;
  markCoachWakeStarted(state, decision, now);
  markCoachObserved(state, transcript, now, scenario.visibleSignals?.includes(decision.signal) ?? false);
}

function recordEvent(
  events: ReplayEvent[],
  atMs: number,
  source: ReplayEvent["source"],
  decision: CoachWakeDecision,
  text?: string
) {
  events.push({
    atMs,
    source,
    decision: decision.shouldWake ? "wake" : "skip",
    signal: decision.signal,
    reason: decision.reason,
    text,
  });
}

function summarizeScenario(scenario: ReplayScenario, events: ReplayEvent[]) {
  const wakes = events.filter((event) => event.decision === "wake");
  const expected = [...scenario.expectedWakeSignals];
  const hits = expected.filter((signal) => wakes.some((event) => event.signal === signal));
  const missed = expected.filter((signal) => !wakes.some((event) => event.signal === signal));
  const allowedExtra = new Set<CoachWakeSignal>(["fresh_context", ...(scenario.allowedExtraSignals ?? [])]);
  const expectedRemaining = new Map<CoachWakeSignal, number>();
  for (const signal of expected) {
    expectedRemaining.set(signal, (expectedRemaining.get(signal) ?? 0) + 1);
  }

  const falseWakes: ReplayEvent[] = [];
  for (const wake of wakes) {
    const remaining = expectedRemaining.get(wake.signal) ?? 0;
    if (remaining > 0) {
      expectedRemaining.set(wake.signal, remaining - 1);
      continue;
    }
    if (!allowedExtra.has(wake.signal)) falseWakes.push(wake);
  }

  return {
    name: scenario.name,
    wakeCount: wakes.length,
    skipCount: events.length - wakes.length,
    expectedWakeHitRate: expected.length === 0 ? 1 : hits.length / expected.length,
    falseWakeCount: falseWakes.length,
    missedWakeCount: missed.length,
    missed,
    falseWakes,
    events,
    passed: missed.length === 0 && falseWakes.length === 0,
  };
}

function main() {
  const results = scenarios.map(runScenario);
  const directAssertions = runDirectAssertions();
  for (const result of results) {
    console.log(
      `${result.passed ? "PASS" : "FAIL"} ${result.name} wakes=${result.wakeCount} skips=${result.skipCount} hit=${result.expectedWakeHitRate.toFixed(2)} false=${result.falseWakeCount} missed=${result.missedWakeCount}`
    );
    for (const event of result.events) {
      console.log(
        `  ${event.atMs.toString().padStart(5, " ")}ms ${event.source.padEnd(10)} ${event.decision.padEnd(4)} signal=${event.signal} reason=${event.reason}${event.text ? ` text=${event.text.slice(0, 40)}` : ""}`
      );
    }
  }

  const failed = results.filter((result) => !result.passed);
  if (!directAssertions.passed) {
    failed.push({
      name: "direct-assertions",
      passed: false,
      wakeCount: 0,
      skipCount: 0,
      expectedWakeHitRate: 0,
      falseWakeCount: directAssertions.failures.length,
      missedWakeCount: directAssertions.failures.length,
      missed: directAssertions.failures,
      falseWakes: [],
      events: [],
    });
  }
  const summary = {
    scenarios: results.length,
    passed: results.length - failed.length + (directAssertions.passed ? 1 : 0),
    failed: failed.length,
    wakeCount: results.reduce((sum, result) => sum + result.wakeCount, 0),
    falseWakeCount: results.reduce((sum, result) => sum + result.falseWakeCount, 0),
    missedWakeCount: results.reduce((sum, result) => sum + result.missedWakeCount, 0),
  };
  console.log(`\nsummary=${JSON.stringify(summary)}`);
  if (!directAssertions.passed) {
    console.error(`direct_assertions_failed=${JSON.stringify(directAssertions.failures)}`);
  }

  if (failed.length > 0) {
    process.exit(1);
  }
}

function runDirectAssertions() {
  const failures: string[] = [];
  const transcript: TranscriptSegment[] = [
    {
      id: "direct-1",
      source: "microphone",
      speaker: "unknown",
      text: "普通新增内容",
      startMs: 0,
      endMs: 1000,
    },
  ];
  const state = createInitialCoachWakeState();
  const inFlight = evaluateHeartbeatWake({
    now: 10_000,
    transcript,
    recentCandidates: [],
    state,
    coachInFlight: true,
  });
  if (inFlight.shouldWake || inFlight.reason !== "in_flight") {
    failures.push("heartbeat_in_flight_should_skip");
  }

  const idleObserve = evaluateHeartbeatWake({
    now: 10_000,
    transcript,
    recentCandidates: [],
    state,
    coachInFlight: false,
  });
  if (!idleObserve.shouldWake || idleObserve.signal !== "fresh_context") {
    failures.push("heartbeat_idle_should_observe");
  }

  const latest = detectLatestQuestion([
    {
      id: "latest-setup",
      source: "microphone",
      speaker: "unknown",
      text: "你好，能听得到吗？说一下。",
      startMs: 0,
      endMs: 1000,
    },
    {
      id: "latest-topic",
      source: "microphone",
      speaker: "interviewer",
      text: "React fiber 的原理。",
      startMs: 3000,
      endMs: 4200,
    },
    {
      id: "latest-answer",
      source: "microphone",
      speaker: "user",
      text: "React fiber 是 React 的一种渲染架构。",
      startMs: 5000,
      endMs: 6200,
    },
  ]);
  if (latest?.text !== "React fiber 的原理。") {
    failures.push(`latest_question_should_ignore_setup:${latest?.text ?? "null"}`);
  }

  const askContext = buildInterviewAskContext([
    {
      id: "ask-setup",
      source: "microphone",
      speaker: "unknown",
      text: "你好，能听得到吗？说一下。",
      startMs: 0,
      endMs: 1000,
    },
    {
      id: "ask-topic",
      source: "microphone",
      speaker: "interviewer",
      text: "React fiber 的原理。",
      startMs: 3000,
      endMs: 4200,
    },
  ]);
  if (!askContext?.userMessage.includes("Do not rely on any app-extracted question")) {
    failures.push("ask_context_should_delegate_question_detection_to_model");
  }
  if (askContext?.userMessage.includes("Latest question or latest transcript")) {
    failures.push("ask_context_should_not_include_engineered_latest_question");
  }

  return {
    passed: failures.length === 0,
    failures,
  };
}

main();
