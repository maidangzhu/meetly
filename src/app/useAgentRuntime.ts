import { useCallback, useEffect, useRef } from "react";
import {
  AgentRuntime,
  ContextStore,
  createEnterWake,
  createTauriAgentTransport,
  detectSttWake,
  type AgentRuntimeCallbacks,
  type WakeEvent,
} from "../runtime/agent";
import { createId, debugLog } from "./platform";
import type { CoachMessage, CoachTrigger, TranscriptSegment } from "./types";
import type { MeetlyState } from "./useMeetlyState";

export function useAgentRuntime(ctx: MeetlyState) {
  const contextRef = useRef<ContextStore | null>(null);
  const runtimeRef = useRef<AgentRuntime | null>(null);
  const currentSessionIdRef = useRef<string | null>(null);

  if (!contextRef.current) {
    contextRef.current = new ContextStore();
  }

  if (!runtimeRef.current) {
    runtimeRef.current = new AgentRuntime(
      contextRef.current,
      createTauriAgentTransport(),
      buildCallbacks(ctx)
    );
  }

  runtimeRef.current.setCallbacks(buildCallbacks(ctx));

  useEffect(() => {
    const sessionId = ctx.interviewSession?.id ?? null;
    if (currentSessionIdRef.current === sessionId) {
      return;
    }

    currentSessionIdRef.current = sessionId;
    contextRef.current?.clear();
    setCoachActivity(ctx, null);
    debugLog(`[agent] context reset session=${sessionId ?? "none"}`);
  }, [ctx.interviewSession?.id]);

  const pushTranscriptFinal = useCallback((segment: TranscriptSegment) => {
    contextRef.current?.pushTranscript(segment);

    const wake = detectSttWake(segment);
    if (!wake) {
      debugLog(`[agent] stt wake skipped segment=${segment.id}`);
      return;
    }

    debugLog(`[agent] stt wake segment=${segment.id} reason=${wake.reason}`);
    runtimeRef.current?.wake(wake);
  }, []);

  const wakeEnter = useCallback(() => {
    const wake = createEnterWake();
    debugLog(`[agent] enter wake reason=${wake.reason}`);
    runtimeRef.current?.wake(wake);
  }, []);

  return {
    pushTranscriptFinal,
    wakeEnter,
  };
}

function buildCallbacks(ctx: MeetlyState): AgentRuntimeCallbacks {
  return {
    onWakeStart: (wake) => {
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
      debugLog(`[agent] wake skipped wake=${wake.kind} reason=${reason}`);
    },
    onMessage: (suggestion, wake) => {
      const message = buildCoachMessage(wake, suggestion.answer);
      const next = [...ctx.coachMessagesRef.current, message].slice(-8);
      ctx.coachMessagesRef.current = next;
      ctx.setCoachMessages(next);
      ctx.setCoachDraft(null);
      ctx.setIsCoachThinking(false);
      ctx.coachInFlightRef.current = false;
      setCoachActivity(ctx, {
        phase: "speaking",
        label: "说话中",
      }, 1_200);
      debugLog(`[agent] coach message wake=${wake.kind} chars=${suggestion.answer.length}`);
    },
    onError: (message, wake) => {
      const errorMessage = buildCoachMessage(wake, `教练生成失败：${message}`);
      const next = [...ctx.coachMessagesRef.current, errorMessage].slice(-8);
      ctx.coachMessagesRef.current = next;
      ctx.setCoachMessages(next);
      ctx.setCoachDraft(null);
      ctx.setIsCoachThinking(false);
      ctx.coachInFlightRef.current = false;
      setCoachActivity(ctx, null);
      debugLog(`[agent] error wake=${wake.kind} message=${message}`);
    },
  };
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

function buildCoachMessage(wake: WakeEvent, text: string): CoachMessage {
  return {
    id: createId("coach"),
    createdAt: Date.now(),
    trigger: toCoachTrigger(wake),
    text,
    contextPreview: wake.evidence.join("\n").slice(0, 260),
  };
}

function toCoachTrigger(wake: WakeEvent): CoachTrigger {
  if (wake.kind === "enter") return "agent_enter";
  return "agent_stt_question";
}

export type AgentRuntimeActions = ReturnType<typeof useAgentRuntime>;
