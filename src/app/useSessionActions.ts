import { useCallback } from "react";
import { debugLog } from "./platform";
import type { AutoAssistHint, ContextDocument, InterviewSession } from "./types";
import type { MeetlyState } from "./useMeetlyState";

export function useSessionActions(ctx: MeetlyState) {
  const setCurrentInterviewSession = useCallback((next: InterviewSession | null) => {
    ctx.interviewSessionRef.current = next;
    ctx.setInterviewSession(next);
  }, [ctx]);

  const updateInterviewSession = useCallback((updater: (session: InterviewSession) => InterviewSession) => {
    const current = ctx.interviewSessionRef.current;
    if (!current) {
      return null;
    }

    const next = updater(current);
    setCurrentInterviewSession(next);
    return next;
  }, [ctx, setCurrentInterviewSession]);

  const setCurrentAutoAssistHint = useCallback((hint: AutoAssistHint | null) => {
    if (ctx.hintExpiryTimerRef.current !== null) {
      window.clearTimeout(ctx.hintExpiryTimerRef.current);
      ctx.hintExpiryTimerRef.current = null;
    }

    ctx.autoAssistHintRef.current = hint;
    ctx.setAutoAssistHint(hint);

    if (hint) {
      const delay = Math.max(0, hint.expiresAt - Date.now());
      ctx.hintExpiryTimerRef.current = window.setTimeout(() => {
        const current = ctx.autoAssistHintRef.current;
        if (current?.candidate.id !== hint.candidate.id) {
          return;
        }

        debugLog(`[auto] hint expired candidate=${hint.candidate.id}`);
        ctx.autoAssistHintRef.current = null;
        ctx.setAutoAssistHint(null);
        updateInterviewSession((session) => ({
          ...session,
          autoAssistCandidate:
            session.autoAssistCandidate?.id === hint.candidate.id
              ? null
              : session.autoAssistCandidate,
        }));
      }, delay);
    }
  }, [ctx, updateInterviewSession]);

  const dismissAutoAssistHint = useCallback(() => {
    const current = ctx.autoAssistHintRef.current;
    if (current) {
      debugLog(`[auto] hint dismissed candidate=${current.candidate.id}`);
      updateInterviewSession((session) => ({
        ...session,
        autoAssistCandidate:
          session.autoAssistCandidate?.id === current.candidate.id
            ? null
            : session.autoAssistCandidate,
      }));
    }
    setCurrentAutoAssistHint(null);
  }, [ctx, setCurrentAutoAssistHint, updateInterviewSession]);

  const addContextDocuments = useCallback((documents: ContextDocument[]) => {
    if (documents.length === 0) {
      return;
    }

    const next = [...ctx.contextDocumentsRef.current, ...documents].slice(-6);
    ctx.contextDocumentsRef.current = next;
    ctx.setContextDocuments(next);
    updateInterviewSession((current) => ({
      ...current,
      documents: next,
    }));
    debugLog(`[context] documents added count=${documents.length} total=${next.length}`);
  }, [ctx, updateInterviewSession]);

  const removeContextDocument = useCallback((id: string) => {
    const next = ctx.contextDocumentsRef.current.filter((document) => document.id !== id);
    ctx.contextDocumentsRef.current = next;
    ctx.setContextDocuments(next);
    updateInterviewSession((current) => ({
      ...current,
      documents: next,
    }));
    debugLog(`[context] document removed id=${id} total=${next.length}`);
  }, [ctx, updateInterviewSession]);

  return {
    activeSessionTranscriptCount: ctx.interviewSession?.transcript.length ?? 0,
    addContextDocuments,
    dismissAutoAssistHint,
    removeContextDocument,
    setCurrentAutoAssistHint,
    setCurrentInterviewSession,
    updateInterviewSession,
  };
}

export type SessionActions = ReturnType<typeof useSessionActions>;
