import { useCallback } from "react";
import type { CoachWakeDecision } from "./coachWakePolicy";
import type { CoachTrigger, QuestionCandidate } from "./types";
import type { MeetlyState } from "./useMeetlyState";

export function usePiCoach(ctx: MeetlyState) {
  const runPiCoach = useCallback(async ({
    trigger: _trigger,
    candidate: _candidate,
    latestAnswer: _latestAnswer,
    wakeDecision: _wakeDecision,
  }: {
    trigger: CoachTrigger;
    candidate?: QuestionCandidate;
    latestAnswer?: string;
    wakeDecision?: CoachWakeDecision;
  }) => {
    ctx.coachInFlightRef.current = false;
    ctx.setCoachDraft(null);
    ctx.setIsCoachThinking(false);
  }, [ctx]);

  return { runPiCoach };
}

export type PiCoachActions = ReturnType<typeof usePiCoach>;
