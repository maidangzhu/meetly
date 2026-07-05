import { useCallback, useEffect, useRef } from "react";
import { COACH_HEARTBEAT_MS, COACH_MAX_MESSAGES } from "./constants";
import { buildPiCoachPrompt } from "./interviewLogic";
import { createId, debugLog } from "./platform";
import type { CoachMessage, CoachTrigger, QuestionCandidate } from "./types";
import type { MeetlyState } from "./useMeetlyState";
import { runPiObserver } from "../runtime/piObserver";

export function usePiCoach(ctx: MeetlyState) {
  const appendCoachMessage = useCallback((message: CoachMessage) => {
    const next = [...ctx.coachMessagesRef.current, message].slice(-COACH_MAX_MESSAGES);
    ctx.coachMessagesRef.current = next;
    ctx.setCoachMessages(next);
  }, [ctx]);

  const runPiCoach = useCallback(async ({
    trigger,
    candidate,
    latestAnswer,
  }: {
    trigger: CoachTrigger;
    candidate?: QuestionCandidate;
    latestAnswer?: string;
  }) => {
    const session = ctx.interviewSessionRef.current;
    if (!session || session.endedAt) {
      return;
    }

    if (ctx.coachInFlightRef.current) {
      debugLog(`[pi] coach skipped reason=in_flight trigger=${trigger}`);
      return;
    }

    const prompt = buildPiCoachPrompt({
      trigger,
      transcript: ctx.transcriptHistoryRef.current,
      candidate,
      latestAnswer,
    });
    const draft: CoachMessage = {
      id: createId("coach"),
      createdAt: Date.now(),
      trigger,
      text: "",
      contextPreview: prompt.slice(-260),
    };

    ctx.coachInFlightRef.current = true;
    ctx.lastCoachAtRef.current = Date.now();
    ctx.setIsCoachThinking(true);
    ctx.setCoachDraft(draft);
    debugLog(`[pi] coach start trigger=${trigger} session=${session.id}`);

    try {
      const response = await runPiObserver({
        sessionId: session.id,
        trigger,
        prompt,
        onDelta: (delta) => {
          draft.text += delta;
          ctx.setCoachDraft({ ...draft });
        },
      });
      const text = response?.text.trim() ?? "";
      if (!text || text.toUpperCase() === "SILENT") {
        debugLog(`[pi] coach silent trigger=${trigger}`);
        ctx.setCoachDraft(null);
        return;
      }

      appendCoachMessage({ ...draft, trigger, text });
      ctx.setCoachDraft(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      debugLog(`[pi] coach error trigger=${trigger} message=${message}`);
      ctx.setCoachDraft(null);
    } finally {
      ctx.coachInFlightRef.current = false;
      ctx.setIsCoachThinking(false);
    }
  }, [appendCoachMessage, ctx]);

  const runPiCoachRef = useRef(runPiCoach);
  useEffect(() => {
    runPiCoachRef.current = runPiCoach;
  }, [runPiCoach]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      const session = ctx.interviewSessionRef.current;
      if (!session || session.endedAt) {
        return;
      }

      if (ctx.coachInFlightRef.current) {
        debugLog("[pi] heartbeat skipped reason=in_flight");
        return;
      }

      void runPiCoachRef.current({ trigger: "heartbeat" });
    }, COACH_HEARTBEAT_MS);

    return () => window.clearInterval(timer);
    // Refs and React setters inside ctx are stable for the component lifetime.
  }, []);

  return { runPiCoach };
}

export type PiCoachActions = ReturnType<typeof usePiCoach>;
