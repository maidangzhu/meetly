import { useCallback, useEffect, useRef } from "react";
import {
  AgentRuntime,
  CoachEventJournal,
  ContextStore,
  createEnterWake,
  createSessionStartWake,
  createPiCoachTransport,
  detectSttWake,
  type AgentRuntimeCallbacks,
  type WakeEvent,
} from "../runtime/agent";
import { debugLog } from "./platform";
import type {
  AudioSource,
  CoachMessage,
  CoachToolTrace,
  CoachTrigger,
  SessionKind,
  TranscriptSegment,
} from "./types";
import type { MeetlyState } from "./useMeetlyState";

export function useAgentRuntime(ctx: MeetlyState) {
  const contextRef = useRef<ContextStore | null>(null);
  const journalRef = useRef<CoachEventJournal | null>(null);
  const runtimeRef = useRef<AgentRuntime | null>(null);
  const currentSessionIdRef = useRef<string | null>(null);
  const sessionStartEventIdRef = useRef<string | null>(null);
  const manualAskEventIdsRef = useRef(new Map<string, string>());

  if (!contextRef.current) {
    contextRef.current = new ContextStore();
  }

  if (!journalRef.current) {
    journalRef.current = new CoachEventJournal();
  }

  if (!runtimeRef.current) {
    runtimeRef.current = new AgentRuntime(
      contextRef.current,
      createPiCoachTransport(),
      buildCallbacks(ctx, journalRef.current)
    );
  }

  runtimeRef.current.setCallbacks(buildCallbacks(ctx, journalRef.current));

  useEffect(() => {
    const sessionId = ctx.interviewSession?.id ?? null;
    if (currentSessionIdRef.current === sessionId) {
      return;
    }

    currentSessionIdRef.current = sessionId;
    contextRef.current?.clear();
    contextRef.current?.setSessionId(sessionId);
    setCoachActivity(ctx, null);
    debugLog(`[agent] context reset session=${sessionId ?? "none"}`);
  }, [ctx.interviewSession?.id]);

  useEffect(() => {
    contextRef.current?.setPerspective(ctx.meetingPerspective);
  }, [ctx.meetingPerspective]);

  useEffect(() => {
    contextRef.current?.setDocuments(ctx.contextDocuments);
  }, [ctx.contextDocuments]);

  useEffect(() => {
    contextRef.current?.setSessionConfig({
      kind: ctx.sessionKind,
      audioSource: ctx.audioSource,
      goal: ctx.meetingGoal,
    });
  }, [ctx.audioSource, ctx.meetingGoal, ctx.sessionKind]);

  const pushTranscriptFinal = useCallback((segment: TranscriptSegment) => {
    contextRef.current?.pushTranscript(segment);

    const sessionId = currentSessionIdRef.current;
    const observed = sessionId
      ? journalRef.current?.appendEvent({
          sessionId,
          type: "transcript.finalized",
          source: segment.source ?? "system",
          segmentId: segment.id,
          speaker: toJournalSpeaker(segment.speaker),
          evidencePreview: segment.text,
          details: {
            startMs: segment.startMs,
            endMs: segment.endMs,
          },
        })
      : null;

    const detectedWake = detectSttWake(segment, ctx.sessionKind);
    const wake = detectedWake
      ? {
          ...detectedWake,
          sessionId: sessionId ?? undefined,
          evidenceEventIds: observed ? [observed.id] : [],
        }
      : null;
    if (!wake) {
      debugLog(`[agent] stt wake skipped segment=${segment.id}`);
      return;
    }

    debugLog(`[agent] stt wake segment=${segment.id} reason=${wake.reason}`);
    runtimeRef.current?.wake(wake);
  }, [ctx.sessionKind]);

  const wakeEnter = useCallback(() => {
    const sessionId = currentSessionIdRef.current;
    const wake = { ...createEnterWake(), sessionId: sessionId ?? undefined };
    debugLog(`[agent] enter wake reason=${wake.reason}`);
    runtimeRef.current?.wake(wake);
  }, []);

  const wakeSessionStart = useCallback((sessionId: string, hasDocuments: boolean) => {
    if (currentSessionIdRef.current !== sessionId) {
      currentSessionIdRef.current = sessionId;
      contextRef.current?.clear();
      contextRef.current?.setSessionId(sessionId);
    }
    const wake = createSessionStartWake(hasDocuments);
    wake.sessionId = sessionId;
    wake.evidenceEventIds = sessionStartEventIdRef.current ? [sessionStartEventIdRef.current] : [];
    debugLog(`[agent] session wake session=${sessionId} reason=${wake.reason}`);
    runtimeRef.current?.wake(wake);
  }, []);

  const recordSessionStarted = useCallback((input: {
    sessionId: string;
    sessionKind: SessionKind;
    audioSource: AudioSource;
    hasDocuments: boolean;
  }) => {
    currentSessionIdRef.current = input.sessionId;
    contextRef.current?.clear();
    contextRef.current?.setSessionId(input.sessionId);
    journalRef.current?.clear();
    const event = journalRef.current?.appendEvent({
      sessionId: input.sessionId,
      type: "session.started",
      source: "runtime",
      details: {
        sessionKind: input.sessionKind,
        audioSource: input.audioSource,
        hasDocuments: input.hasDocuments,
      },
    });
    sessionStartEventIdRef.current = event?.id ?? null;
  }, []);

  const recordCaptureStarted = useCallback((sessionId: string, source: AudioSource) => {
    journalRef.current?.appendEvent({
      sessionId,
      type: "audio.capture.started",
      source,
      details: { source },
    });
  }, []);

  const recordCaptureFailed = useCallback((sessionId: string, source: AudioSource) => {
    journalRef.current?.appendEvent({
      sessionId,
      type: "audio.capture.failed",
      source,
      details: { source, reason: "capture_start_failed" },
    });
  }, []);

  const recordSessionEnded = useCallback((sessionId: string) => {
    journalRef.current?.appendEvent({
      sessionId,
      type: "session.ended",
      source: "runtime",
    });
  }, []);

  const recordManualAskStarted = useCallback((askId: string) => {
    runtimeRef.current?.beginManualAsk();
    setCoachActivity(ctx, null);
    ctx.setCoachDraft(null);
    ctx.setIsCoachThinking(false);
    ctx.coachToolTracesRef.current = [];
    ctx.coachInFlightRef.current = false;
    const sessionId = currentSessionIdRef.current;
    if (!sessionId) return;
    const event = journalRef.current?.appendEvent({
      sessionId,
      type: "user.manual_ask",
      source: "ui",
    });
    if (!event) return;
    manualAskEventIdsRef.current.set(askId, event.id);
    journalRef.current?.appendTransition({
      sessionId,
      status: "running",
      reason: "user_manual_ask",
      wakeId: askId,
      runId: askId,
      eventIds: [event.id],
    });
  }, []);

  const recordManualAskFinished = useCallback((
    askId: string,
    status: "spoken" | "failed",
    reason: string
  ) => {
    runtimeRef.current?.finishManualAsk();
    const sessionId = currentSessionIdRef.current;
    const eventId = manualAskEventIdsRef.current.get(askId);
    if (!sessionId || !eventId) return;
    journalRef.current?.appendTransition({
      sessionId,
      status,
      reason,
      wakeId: askId,
      runId: askId,
      eventIds: [eventId],
    });
    manualAskEventIdsRef.current.delete(askId);
  }, []);

  return {
    pushTranscriptFinal,
    recordCaptureFailed,
    recordCaptureStarted,
    recordManualAskFinished,
    recordManualAskStarted,
    recordSessionEnded,
    recordSessionStarted,
    wakeEnter,
    wakeSessionStart,
  };
}

function buildCallbacks(ctx: MeetlyState, journal: CoachEventJournal): AgentRuntimeCallbacks {
  return {
    onDelta: (delta, wake) => {
      ctx.setCoachDraft((current) => {
        const draft = current ?? buildCoachMessage(wake, "");
        return {
          ...draft,
          text: `${draft.text}${delta}`,
        };
      });
    },
    onWakeStart: (wake) => {
      appendWakeTransition(journal, wake, "running", wake.reason);
      ctx.coachToolTracesRef.current = [];
      const draft = buildCoachMessage(wake, "");
      ctx.coachInFlightRef.current = true;
      ctx.setIsCoachThinking(true);
      ctx.setCoachDraft(draft);
      setCoachActivity(ctx, {
        phase: "thinking",
        label: "思考中",
        detail: wake.evidence[0] ? `参考：${wake.evidence[0].slice(0, 80)}` : undefined,
      });
      debugLog(`[agent] coach start wake=${wake.kind} reason=${wake.reason}`);
    },
    onWakeSkipped: (wake, reason) => {
      appendWakeTransition(journal, wake, "ignored", reason);
      debugLog(`[agent] wake skipped wake=${wake.kind} reason=${reason}`);
    },
    onRetry: (attempt, reason, wake) => {
      appendWakeTransition(journal, wake, "running", reason, { attempt });
      ctx.setCoachDraft(buildCoachMessage(wake, ""));
      setCoachActivity(ctx, {
        phase: "thinking",
        label: "重新尝试",
        detail: "上一请求超过 10 秒，已丢弃并重发",
      });
      debugLog(`[agent] coach retry wake=${wake.kind} attempt=${attempt} reason=${reason}`);
    },
    onMessage: (suggestion, wake) => {
      appendWakeTransition(journal, wake, "spoken", "message_committed", {
        answerChars: suggestion.answer.length,
      });
      const message = buildCoachMessage(wake, suggestion.answer, ctx.coachToolTracesRef.current);
      const next = [...ctx.coachMessagesRef.current, message].slice(-8);
      ctx.coachMessagesRef.current = next;
      ctx.setCoachMessages(next);
      ctx.setCoachDraft(null);
      ctx.coachToolTracesRef.current = [];
      ctx.setIsCoachThinking(false);
      ctx.coachInFlightRef.current = false;
      setCoachActivity(ctx, {
        phase: "speaking",
        label: "说话中",
      }, 1_200);
      debugLog(`[agent] coach message wake=${wake.kind} chars=${suggestion.answer.length}`);
    },
    onError: (message, wake) => {
      appendWakeTransition(journal, wake, "failed", "run_failed");
      const errorMessage = buildCoachMessage(wake, `教练生成失败：${message}`, ctx.coachToolTracesRef.current);
      const next = [...ctx.coachMessagesRef.current, errorMessage].slice(-8);
      ctx.coachMessagesRef.current = next;
      ctx.setCoachMessages(next);
      ctx.setCoachDraft(null);
      ctx.coachToolTracesRef.current = [];
      ctx.setIsCoachThinking(false);
      ctx.coachInFlightRef.current = false;
      setCoachActivity(ctx, null);
      debugLog(`[agent] error wake=${wake.kind} message=${message}`);
    },
    onToolEnd: (name, isError) => {
      setCoachActivity(ctx, {
        phase: "tool",
        label: isError ? `${toolLabel(name)}失败` : `${toolLabel(name)}完成`,
      }, 1_200);
      debugLog(`[agent] coach tool end name=${name} error=${isError}`);
    },
    onToolStart: (name) => {
      setCoachActivity(ctx, {
        phase: "tool",
        label: toolLabel(name),
      });
      debugLog(`[agent] coach tool start name=${name}`);
    },
    onToolTrace: (trace) => {
      ctx.coachToolTracesRef.current = upsertToolTrace(ctx.coachToolTracesRef.current, trace);
      ctx.setCoachDraft((current) => {
        if (!current) {
          return current;
        }
        return {
          ...current,
          toolTraces: ctx.coachToolTracesRef.current,
        };
      });
      debugLog(`[agent] coach tool trace name=${trace.name} status=${trace.status}`);
    },
  };
}

function appendWakeTransition(
  journal: CoachEventJournal,
  wake: WakeEvent,
  status: "ignored" | "running" | "spoken" | "failed",
  reason: string,
  details?: Record<string, string | number | boolean | null>
) {
  if (!wake.sessionId) return;
  journal.appendTransition({
    sessionId: wake.sessionId,
    status,
    reason,
    wakeId: wake.id,
    runId: wake.id,
    eventIds: wake.evidenceEventIds,
    details,
  });
}

function toJournalSpeaker(speaker: TranscriptSegment["speaker"]) {
  if (speaker === "user") return "user" as const;
  if (speaker === "interviewer") return "other" as const;
  return "unknown" as const;
}

function setCoachActivity(
  ctx: MeetlyState,
  activity: MeetlyState["coachActivity"],
  clearAfterMs?: number
) {
  if (ctx.coachActivityClearTimerRef.current !== null) {
    window.clearTimeout(ctx.coachActivityClearTimerRef.current);
    ctx.coachActivityClearTimerRef.current = null;
  }

  ctx.setCoachActivity(activity);

  if (activity && clearAfterMs) {
    ctx.coachActivityClearTimerRef.current = window.setTimeout(() => {
      ctx.setCoachActivity(null);
      ctx.coachActivityClearTimerRef.current = null;
    }, clearAfterMs);
  }
}

function buildCoachMessage(wake: WakeEvent, text: string, toolTraces: CoachToolTrace[] = []): CoachMessage {
  return {
    id: wake.id,
    createdAt: Date.now(),
    trigger: toCoachTrigger(wake),
    text,
    contextPreview: wake.evidence.join("\n").slice(0, 260),
    toolTraces,
  };
}

function toCoachTrigger(wake: WakeEvent): CoachTrigger {
  if (wake.kind === "enter") return "agent_enter";
  if (wake.kind === "session_start") return "session_started";
  if (wake.kind === "stt_signal" && wake.reason === "external_context_needed") return "research_signal";
  if (wake.kind === "stt_signal") return "context_signal";
  return "agent_stt_question";
}

function toolLabel(name: string) {
  if (name === "read_file") return "读取资料";
  if (name === "web_search" || name === "web_fetch") return "获取网页信息";
  return "使用工具";
}

function upsertToolTrace(current: CoachToolTrace[], trace: CoachToolTrace) {
  const index = current.findIndex((item) => item.id === trace.id);
  if (index < 0) {
    return [...current, trace];
  }

  const next = [...current];
  next[index] = {
    ...next[index],
    ...trace,
    createdAt: next[index].createdAt,
  };
  return next;
}

export type AgentRuntimeActions = ReturnType<typeof useAgentRuntime>;
