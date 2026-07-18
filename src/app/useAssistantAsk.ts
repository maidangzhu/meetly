import { useCallback, useEffect } from "react";
import { buildAgentChatContext, buildAgentChatHistory, resolveAgentChatMessage } from "./agentChat";
import { createId, debugLog, safeInvoke } from "./platform";
import type { AgentChatTurn, AssistantSuggestion } from "./types";
import type { MeetlyState } from "./useMeetlyState";
import type { AgentRuntimeActions } from "./useAgentRuntime";
import type { SessionActions } from "./useSessionActions";
import type { WindowActions } from "./useWindowActions";

export function useAssistantAsk(
  ctx: MeetlyState,
  session: SessionActions,
  windowActions: WindowActions,
  flushCurrentMicSegment: () => Promise<void>,
  agent: AgentRuntimeActions
) {
  const askAssistant = useCallback(async (message = "需要帮助") => {
    if (ctx.isAsking) {
      return;
    }

    const question = resolveAgentChatMessage(message);
    ctx.setIsAsking(true);
    ctx.setAssistantError(null);
    ctx.setAssistantSuggestion(null);
    ctx.setAssistantDraft("");
    await windowActions.setPanel("assistant");
    const askId = createId("ask");
    const createdAt = Date.now();
    const pendingTurn: AgentChatTurn = {
      id: askId,
      createdAt,
      question,
      suggestion: null,
      error: null,
      toolTraces: [],
    };
    const previousTurns = buildAgentChatHistory(ctx.agentChatTurnsRef.current);
    setChatTurns(ctx, [...ctx.agentChatTurnsRef.current, pendingTurn]);
    agent.recordManualAskStarted(askId);

    try {
      await flushCurrentMicSegment();
      ctx.prefetchInFlightRef.current = null;
      ctx.prefetchCacheRef.current = null;
      session.setCurrentAutoAssistHint(null);
      ctx.setPrefetchStatus("idle");

      const context = buildAgentChatContext({
        documents: ctx.contextDocumentsRef.current,
        goal: ctx.meetingGoal,
        transcript: ctx.transcriptHistoryRef.current,
      });
      session.updateInterviewSession((current) => ({
        ...current,
        status: "asking",
        asks: [...current.asks, {
          id: askId,
          createdAt,
          latestQuestion: question,
          contextPreview: context.slice(0, 320),
          answer: null,
          error: null,
        }],
      }));

      debugLog(
        `[agent-chat] submit chars=${question.length} history_turns=${previousTurns.length} context_chars=${context.length}`
      );
      const suggestion = await safeInvoke<AssistantSuggestion>("complete_voice_ask", {
        runId: askId,
        question,
        selectedText: context || null,
        turns: previousTurns,
      }) ?? buildBrowserPreviewSuggestion(question);

      setChatTurns(ctx, ctx.agentChatTurnsRef.current.map((turn) =>
        turn.id === askId ? { ...turn, suggestion, error: null } : turn
      ));
      ctx.setAssistantSuggestion(suggestion);
      ctx.setAssistantError(null);
      ctx.setIsAsking(false);
      agent.recordManualAskFinished(askId, "spoken", "message_committed");
      session.updateInterviewSession((current) => ({
        ...current,
        status: current.endedAt ? "idle" : "listening",
        asks: current.asks.map((ask) =>
          ask.id === askId ? { ...ask, answer: suggestion.answer, error: null } : ask
        ),
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      agent.recordManualAskFinished(askId, "failed", "request_failed");
      ctx.setAssistantError(message);
      ctx.setAssistantDraft("");
      ctx.setIsAsking(false);
      setChatTurns(ctx, ctx.agentChatTurnsRef.current.map((turn) =>
        turn.id === askId ? { ...turn, error: message } : turn
      ));
      session.updateInterviewSession((current) => ({
        ...current,
        status: current.endedAt ? "idle" : "listening",
        asks: current.asks.map((ask) => ask.id === askId ? { ...ask, error: message } : ask),
      }));
    }
  }, [agent, ctx, flushCurrentMicSegment, session, windowActions]);

  useEffect(() => {
    const handleAskShortcut = (event: KeyboardEvent) => {
      if (event.key !== "Enter" || event.shiftKey || event.metaKey || event.ctrlKey || event.altKey) {
        return;
      }

      const target = event.target as HTMLElement | null;
      const isTextInput =
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.isContentEditable;

      if (isTextInput) {
        return;
      }

      event.preventDefault();
      void askAssistant("需要帮助");
    };

    window.addEventListener("keydown", handleAskShortcut);
    return () => window.removeEventListener("keydown", handleAskShortcut);
  }, [askAssistant]);

  const clearConversation = useCallback(() => {
    if (ctx.isAsking) return;
    setChatTurns(ctx, []);
    ctx.setAssistantSuggestion(null);
    ctx.setAssistantError(null);
  }, [ctx]);

  return { askAssistant, clearConversation };
}

export type AssistantAskActions = ReturnType<typeof useAssistantAsk>;

function setChatTurns(ctx: MeetlyState, turns: AgentChatTurn[]) {
  const bounded = turns.slice(-24);
  ctx.agentChatTurnsRef.current = bounded;
  ctx.setAgentChatTurns(bounded);
}

function buildBrowserPreviewSuggestion(question: string): AssistantSuggestion {
  return {
    answer: question === "需要帮助"
      ? "可以先把刚才的讨论收束成三个点：已经确认的决定、仍然悬而未决的问题，以及下一步由谁在什么时候完成。"
      : `我会结合当前会话继续回答「${question}」。这里是浏览器预览；桌面应用会使用真实会议上下文。`,
    bullets: [],
    clarifyingQuestion: null,
  };
}
