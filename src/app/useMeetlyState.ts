import { useRef, useState } from "react";
import type {
  AssistantMode,
  AssistantSuggestion,
  AgentChatTurn,
  AudioSource,
  AutoAssistHint,
  CoachActivity,
  CoachMessage,
  CoachToolTrace,
  ContextDocument,
  InterviewSession,
  IslandState,
  MeetingPerspective,
  OpenPanel,
  PrefetchCache,
  PrefetchInFlight,
  PrefetchStatus,
  QuestionCandidate,
  SessionKind,
  PartialTranscript,
  TranscriptSegment,
} from "./types";
import { createInitialCoachWakeState } from "./coachWakePolicy";

export function useMeetlyState() {
  const [state, setState] = useState<IslandState>("idle");
  const [openPanel, setOpenPanel] = useState<OpenPanel>(null);
  const [isStealthOn, setIsStealthOn] = useState(false);
  const [audioLevel, setAudioLevel] = useState(0);
  const [latestTranscript, setLatestTranscript] = useState<TranscriptSegment | null>(null);
  const [partialTranscript, setPartialTranscript] = useState<PartialTranscript | null>(null);
  const [transcriptHistory, setTranscriptHistory] = useState<TranscriptSegment[]>([]);
  const [transcriptError, setTranscriptError] = useState<string | null>(null);
  const [assistantMode, setAssistantMode] = useState<AssistantMode>("meeting");
  const [meetingPerspective, setMeetingPerspective] = useState<MeetingPerspective>("candidate");
  const [sessionKind, setSessionKind] = useState<SessionKind>("remote");
  const [audioSource, setAudioSource] = useState<AudioSource>("system");
  const [meetingGoal, setMeetingGoal] = useState("");
  const [contextDocuments, setContextDocuments] = useState<ContextDocument[]>([]);
  const [contextDocumentMessage, setContextDocumentMessage] = useState<string | null>(null);
  const [assistantSuggestion, setAssistantSuggestion] = useState<AssistantSuggestion | null>(null);
  const [agentChatTurns, setAgentChatTurns] = useState<AgentChatTurn[]>([]);
  const [assistantDraft, setAssistantDraft] = useState("");
  const [assistantError, setAssistantError] = useState<string | null>(null);
  const [isAsking, setIsAsking] = useState(false);
  const [interviewSession, setInterviewSession] = useState<InterviewSession | null>(null);
  const [autoAssistHint, setAutoAssistHint] = useState<AutoAssistHint | null>(null);
  const [prefetchStatus, setPrefetchStatus] = useState<PrefetchStatus>("idle");
  const [coachMessages, setCoachMessages] = useState<CoachMessage[]>([]);
  const [coachDraft, setCoachDraft] = useState<CoachMessage | null>(null);
  const [coachActivity, setCoachActivity] = useState<CoachActivity | null>(null);
  const [isCoachThinking, setIsCoachThinking] = useState(false);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const micAudioContextRef = useRef<AudioContext | null>(null);
  const micAudioSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const micAnalyserRef = useRef<AnalyserNode | null>(null);
  const micVadTimerRef = useRef<number | null>(null);
  const micVadDataRef = useRef<Uint8Array | null>(null);
  const micStartedAtRef = useRef<number>(0);
  const micChunkIndexRef = useRef(0);
  const micSegmentTimerRef = useRef<number | null>(null);
  const micStopRequestedRef = useRef(false);
  const currentSegmentStartedAtRef = useRef(0);
  const currentSegmentHeardSpeechRef = useRef(false);
  const currentSegmentLastVoiceAtRef = useRef(0);
  const transcriptHistoryRef = useRef<TranscriptSegment[]>([]);
  const interviewSessionRef = useRef<InterviewSession | null>(null);
  const contextDocumentsRef = useRef<ContextDocument[]>([]);
  const autoAssistHintRef = useRef<AutoAssistHint | null>(null);
  const prefetchCacheRef = useRef<PrefetchCache | null>(null);
  const prefetchInFlightRef = useRef<PrefetchInFlight | null>(null);
  const recentQuestionCandidatesRef = useRef<QuestionCandidate[]>([]);
  const lastHintShownAtRef = useRef(0);
  const hintExpiryTimerRef = useRef<number | null>(null);
  const coachMessagesRef = useRef<CoachMessage[]>([]);
  const coachToolTracesRef = useRef<CoachToolTrace[]>([]);
  const coachInFlightRef = useRef(false);
  const coachWakeStateRef = useRef(createInitialCoachWakeState());
  const coachActivityClearTimerRef = useRef<number | null>(null);
  const lastCoachAtRef = useRef(0);
  const pendingAskIdRef = useRef<string | null>(null);
  const agentChatTurnsRef = useRef<AgentChatTurn[]>([]);
  const currentRecorderStoppedRef = useRef<Promise<void> | null>(null);
  const currentSegmentTranscriptionRef = useRef<Promise<TranscriptSegment | null> | null>(null);

  return {
    state,
    setState,
    openPanel,
    setOpenPanel,
    isStealthOn,
    setIsStealthOn,
    audioLevel,
    setAudioLevel,
    latestTranscript,
    setLatestTranscript,
    partialTranscript,
    setPartialTranscript,
    transcriptHistory,
    setTranscriptHistory,
    transcriptError,
    setTranscriptError,
    assistantMode,
    setAssistantMode,
    meetingPerspective,
    setMeetingPerspective,
    sessionKind,
    setSessionKind,
    audioSource,
    setAudioSource,
    meetingGoal,
    setMeetingGoal,
    contextDocuments,
    setContextDocuments,
    contextDocumentMessage,
    setContextDocumentMessage,
    assistantSuggestion,
    setAssistantSuggestion,
    agentChatTurns,
    setAgentChatTurns,
    assistantDraft,
    setAssistantDraft,
    assistantError,
    setAssistantError,
    isAsking,
    setIsAsking,
    interviewSession,
    setInterviewSession,
    autoAssistHint,
    setAutoAssistHint,
    prefetchStatus,
    setPrefetchStatus,
    coachMessages,
    setCoachMessages,
    coachDraft,
    setCoachDraft,
    coachActivity,
    setCoachActivity,
    isCoachThinking,
    setIsCoachThinking,
    mediaRecorderRef,
    micStreamRef,
    micAudioContextRef,
    micAudioSourceRef,
    micAnalyserRef,
    micVadTimerRef,
    micVadDataRef,
    micStartedAtRef,
    micChunkIndexRef,
    micSegmentTimerRef,
    micStopRequestedRef,
    currentSegmentStartedAtRef,
    currentSegmentHeardSpeechRef,
    currentSegmentLastVoiceAtRef,
    transcriptHistoryRef,
    interviewSessionRef,
    contextDocumentsRef,
    autoAssistHintRef,
    prefetchCacheRef,
    prefetchInFlightRef,
    recentQuestionCandidatesRef,
    lastHintShownAtRef,
    hintExpiryTimerRef,
    coachMessagesRef,
    coachToolTracesRef,
    coachInFlightRef,
    coachWakeStateRef,
    coachActivityClearTimerRef,
    lastCoachAtRef,
    pendingAskIdRef,
    agentChatTurnsRef,
    currentRecorderStoppedRef,
    currentSegmentTranscriptionRef,
  };
}

export type MeetlyState = ReturnType<typeof useMeetlyState>;
