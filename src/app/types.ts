export type IslandState = "idle" | "listening" | "transcribing" | "thinking" | "error";
export type OpenPanel = null | "assistant";

export type AudioLevelChanged = {
  level: number;
  peak: number;
  rms: number;
  sampleRate: number;
};

export type TranscriptSegment = {
  id: string;
  source?: "microphone";
  speaker?: "interviewer" | "user" | "unknown";
  text: string;
  startMs: number;
  endMs: number;
};

export type TranscriptError = {
  message: string;
};

export type AssistantMode = "interview" | "meeting" | "sales";

export type AssistantSuggestion = {
  answer: string;
  bullets: string[];
  clarifyingQuestion: string | null;
};

export type AssistantErrorPayload = {
  message: string;
};

export type AssistantDeltaPayload = {
  text: string;
};

export type SessionStatus = "idle" | "listening" | "asking" | "error";

export type AskTurn = {
  id: string;
  createdAt: number;
  latestQuestion: string;
  contextPreview: string;
  answer: string | null;
  error: string | null;
};

export type InterviewSession = {
  id: string;
  startedAt: number;
  endedAt: number | null;
  status: SessionStatus;
  transcript: TranscriptSegment[];
  asks: AskTurn[];
  autoAssistCandidate: QuestionCandidate | null;
};

export type LatestQuestionCandidate = {
  text: string;
  confidence: number;
  reason: string;
};

export type AskContext = {
  latest: LatestQuestionCandidate;
  recentSegments: TranscriptSegment[];
  fullSegments: TranscriptSegment[];
  userMessage: string;
  preview: string;
};

export type QuestionKind = "technical" | "behavioral" | "system_design" | "product" | "general";

export type QuestionCandidate = {
  id: string;
  segmentId: string;
  text: string;
  confidence: number;
  reason: string;
  kind: QuestionKind;
  createdAt: number;
};

export type AutoAssistHint = {
  candidate: QuestionCandidate;
  expiresAt: number;
};

export type PrefetchCache = {
  candidateId: string;
  questionText: string;
  suggestion: AssistantSuggestion;
  createdAt: number;
  expiresAt: number;
  contextPreview: string;
};

export type PrefetchInFlight = {
  candidateId: string;
  questionText: string;
  confidence: number;
  startedAt: number;
};

export type PrefetchStatus = "idle" | "prefetching" | "ready" | "error";

export type CoachTrigger = "session_started" | "question_detected" | "manual_ask_done" | "heartbeat";

export type CoachMessage = {
  id: string;
  createdAt: number;
  trigger: CoachTrigger;
  text: string;
  contextPreview: string;
};

export type InterviewReportRequest = {
  sessionId: string;
  startedAt: number;
  endedAt: number;
  assistantMode: AssistantMode;
  transcript: TranscriptSegment[];
  asks: AskTurn[];
  coachMessages: CoachMessage[];
};

export type InterviewReportResult = {
  path: string;
  markdown: string;
};
