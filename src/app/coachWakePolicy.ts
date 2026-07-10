import { AUTO_ASSIST_DEDUPE_WINDOW_MS, AUTO_ASSIST_MIN_CONFIDENCE } from "./constants";
import { questionConfidence, transcriptSimilarity } from "./interviewLogic";
import type { CoachTrigger, QuestionCandidate, TranscriptSegment } from "./types";

export type CoachWakeSignal =
  | "new_question"
  | "followup_cluster"
  | "silence_after_question"
  | "long_answer"
  | "answer_drift"
  | "fresh_context"
  | "none";

export type CoachWakeDecision =
  | {
      shouldWake: true;
      trigger: Extract<CoachTrigger, "question_detected" | "heartbeat" | "manual_ask_done">;
      signal: CoachWakeSignal;
      reason: string;
      priority: number;
      candidateId?: string;
    }
  | {
      shouldWake: false;
      signal: CoachWakeSignal;
      reason: string;
      candidateId?: string;
    };

export type CoachWakeState = {
  lastObservedSegmentId: string | null;
  lastObservedEndMs: number;
  lastWakeAt: number;
  lastVisibleCoachAt: number;
  lastQuestionCandidateId: string | null;
  lastQuestionAt: number;
  silencePromptedCandidateIds: string[];
  longAnswerPromptedCandidateIds: string[];
};

export const COACH_SILENCE_AFTER_QUESTION_MS = 8_000;
export const COACH_LONG_ANSWER_MS = 20_000;

export function createInitialCoachWakeState(): CoachWakeState {
  return {
    lastObservedSegmentId: null,
    lastObservedEndMs: 0,
    lastWakeAt: 0,
    lastVisibleCoachAt: 0,
    lastQuestionCandidateId: null,
    lastQuestionAt: 0,
    silencePromptedCandidateIds: [],
    longAnswerPromptedCandidateIds: [],
  };
}

export function resetCoachWakeState(state: CoachWakeState) {
  const next = createInitialCoachWakeState();
  Object.assign(state, next);
}

export function evaluateTranscriptWake(args: {
  now: number;
  candidate: QuestionCandidate | null;
  recentCandidates: QuestionCandidate[];
  coachInFlight: boolean;
}): CoachWakeDecision {
  const { candidate, coachInFlight, now, recentCandidates } = args;
  if (coachInFlight) {
    return { shouldWake: false, signal: "none", reason: "in_flight", candidateId: candidate?.id };
  }

  if (!candidate) {
    return { shouldWake: false, signal: "none", reason: "no_candidate" };
  }

  const duplicate = recentCandidates.find((item) => {
    if (item.id === candidate.id) return false;
    if (now - item.createdAt > AUTO_ASSIST_DEDUPE_WINDOW_MS) return false;
    return transcriptSimilarity(item.text, candidate.text) >= 0.82;
  });
  if (duplicate) {
    return {
      shouldWake: false,
      signal: "new_question",
      reason: `duplicate_question:${duplicate.id}`,
      candidateId: candidate.id,
    };
  }

  if (candidate.confidence < AUTO_ASSIST_MIN_CONFIDENCE) {
    return {
      shouldWake: false,
      signal: "new_question",
      reason: `low_confidence:${candidate.confidence.toFixed(2)}`,
      candidateId: candidate.id,
    };
  }

  return {
    shouldWake: true,
    trigger: "question_detected",
    signal: "new_question",
    reason: candidate.reason,
    priority: 90,
    candidateId: candidate.id,
  };
}

export function evaluateHeartbeatWake(args: {
  now: number;
  transcript: TranscriptSegment[];
  recentCandidates: QuestionCandidate[];
  state: CoachWakeState;
  coachInFlight: boolean;
}): CoachWakeDecision {
  const { coachInFlight, now, recentCandidates, state, transcript } = args;
  if (coachInFlight) {
    return { shouldWake: false, signal: "none", reason: "in_flight" };
  }

  const latest = latestSegment(transcript);
  if (!latest) {
    return { shouldWake: false, signal: "none", reason: "no_transcript" };
  }

  const latestQuestion = latestQuestionCandidate(recentCandidates, transcript);
  const silenceDecision = evaluateSilenceAfterQuestion({
    now,
    transcript,
    latestQuestion,
    state,
  });
  if (silenceDecision.shouldWake) return silenceDecision;

  const longAnswerDecision = evaluateLongAnswer({
    transcript,
    latestQuestion,
    state,
  });
  if (longAnswerDecision.shouldWake) return longAnswerDecision;

  return {
    shouldWake: true,
    trigger: "heartbeat",
    signal: "fresh_context",
    reason: latest.endMs <= state.lastObservedEndMs || latest.id === state.lastObservedSegmentId
      ? "heartbeat_observe_repeat"
      : "heartbeat_observe_new",
    priority: 20,
  };
}

export function markCoachWakeStarted(state: CoachWakeState, decision: CoachWakeDecision, now: number) {
  if (!decision.shouldWake) return;
  state.lastWakeAt = now;
  if (decision.signal === "new_question" && decision.candidateId) {
    state.lastQuestionCandidateId = decision.candidateId;
    state.lastQuestionAt = now;
  }
  if (decision.signal === "silence_after_question" && decision.candidateId) {
    addUnique(state.silencePromptedCandidateIds, decision.candidateId);
  }
  if (decision.signal === "long_answer" && decision.candidateId) {
    addUnique(state.longAnswerPromptedCandidateIds, decision.candidateId);
  }
}

export function markCoachObserved(state: CoachWakeState, transcript: TranscriptSegment[], now: number, visible: boolean) {
  const latest = latestSegment(transcript);
  if (!latest) return;

  state.lastObservedSegmentId = latest.id;
  state.lastObservedEndMs = latest.endMs;
  if (visible) {
    state.lastVisibleCoachAt = now;
  }
}

function evaluateSilenceAfterQuestion(args: {
  now: number;
  transcript: TranscriptSegment[];
  latestQuestion: QuestionCandidate | null;
  state: CoachWakeState;
}): CoachWakeDecision {
  const { latestQuestion, now, state, transcript } = args;
  if (!latestQuestion) {
    return { shouldWake: false, signal: "silence_after_question", reason: "no_recent_question" };
  }
  if (state.silencePromptedCandidateIds.includes(latestQuestion.id)) {
    return {
      shouldWake: false,
      signal: "silence_after_question",
      reason: "silence_already_prompted",
      candidateId: latestQuestion.id,
    };
  }
  if (state.lastVisibleCoachAt >= latestQuestion.createdAt) {
    return {
      shouldWake: false,
      signal: "silence_after_question",
      reason: "question_already_prompted_visible",
      candidateId: latestQuestion.id,
    };
  }

  const questionSegment = transcript.find((segment) => segment.id === latestQuestion.segmentId);
  const questionEndMs = questionSegment?.endMs ?? 0;
  const answerAfterQuestion = transcript.some((segment) => {
    if (segment.endMs <= questionEndMs) return false;
    if (segment.speaker === "interviewer") return false;
    if (segment.speaker === "user") return true;
    return questionConfidence(segment.text) < AUTO_ASSIST_MIN_CONFIDENCE;
  });
  if (answerAfterQuestion) {
    return {
      shouldWake: false,
      signal: "silence_after_question",
      reason: "user_answer_started",
      candidateId: latestQuestion.id,
    };
  }

  const idleMs = now - latestQuestion.createdAt;
  if (idleMs < COACH_SILENCE_AFTER_QUESTION_MS) {
    return {
      shouldWake: false,
      signal: "silence_after_question",
      reason: `question_idle_not_due:${idleMs}`,
      candidateId: latestQuestion.id,
    };
  }

  return {
    shouldWake: true,
    trigger: "heartbeat",
    signal: "silence_after_question",
    reason: `question_idle:${idleMs}`,
    priority: 75,
    candidateId: latestQuestion.id,
  };
}

function evaluateLongAnswer(args: {
  transcript: TranscriptSegment[];
  latestQuestion: QuestionCandidate | null;
  state: CoachWakeState;
}): CoachWakeDecision {
  const { latestQuestion, state, transcript } = args;
  if (!latestQuestion) {
    return { shouldWake: false, signal: "long_answer", reason: "no_recent_question" };
  }
  if (state.longAnswerPromptedCandidateIds.includes(latestQuestion.id)) {
    return {
      shouldWake: false,
      signal: "long_answer",
      reason: "long_answer_already_prompted",
      candidateId: latestQuestion.id,
    };
  }

  const questionSegment = transcript.find((segment) => segment.id === latestQuestion.segmentId);
  if (!questionSegment) {
    return {
      shouldWake: false,
      signal: "long_answer",
      reason: "question_segment_missing",
      candidateId: latestQuestion.id,
    };
  }

  const answerSegments = transcript.filter((segment) => {
    if (segment.endMs <= questionSegment.endMs) return false;
    if (segment.speaker === "interviewer") return false;
    if (segment.speaker === "user") return true;
    return questionConfidence(segment.text) < AUTO_ASSIST_MIN_CONFIDENCE;
  });
  if (answerSegments.length === 0) {
    return {
      shouldWake: false,
      signal: "long_answer",
      reason: "no_answer_segments",
      candidateId: latestQuestion.id,
    };
  }

  const first = answerSegments[0];
  const latest = answerSegments[answerSegments.length - 1];
  const answerMs = latest.endMs - first.startMs;
  if (answerMs < COACH_LONG_ANSWER_MS) {
    return {
      shouldWake: false,
      signal: "long_answer",
      reason: `answer_not_long:${answerMs}`,
      candidateId: latestQuestion.id,
    };
  }

  return {
    shouldWake: true,
    trigger: "heartbeat",
    signal: "long_answer",
    reason: `answer_too_long:${answerMs}`,
    priority: 55,
    candidateId: latestQuestion.id,
  };
}

function latestQuestionCandidate(candidates: QuestionCandidate[], transcript: TranscriptSegment[]) {
  const newestEndMs = latestSegment(transcript)?.endMs ?? Number.POSITIVE_INFINITY;
  return [...candidates]
    .filter((candidate) => {
      const segment = transcript.find((item) => item.id === candidate.segmentId);
      if (!segment) return false;
      return newestEndMs - segment.endMs <= 120_000;
    })
    .sort((left, right) => right.createdAt - left.createdAt)[0] ?? null;
}

function latestSegment(transcript: TranscriptSegment[]) {
  return transcript.length > 0 ? transcript[transcript.length - 1] : null;
}

function addUnique(items: string[], item: string) {
  if (!items.includes(item)) items.push(item);
  if (items.length > 50) items.splice(0, items.length - 50);
}
