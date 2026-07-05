import { debugLog, safeInvoke } from "./platform";
import type { InterviewReportRequest, InterviewReportResult, InterviewSession } from "./types";

export async function generateInterviewReport(request: InterviewReportRequest) {
  try {
    const result = await safeInvoke<InterviewReportResult>("generate_interview_report", { request });
    if (result?.path) {
      debugLog(`[report] saved path=${result.path}`);
    }
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    debugLog(`[report] error message=${message}`);
    return null;
  }
}

export function buildInterviewReportRequest({
  assistantMode,
  coachMessages,
  endedAt,
  session,
}: {
  assistantMode: InterviewReportRequest["assistantMode"];
  coachMessages: InterviewReportRequest["coachMessages"];
  endedAt: number;
  session: InterviewSession;
}): InterviewReportRequest {
  return {
    sessionId: session.id,
    startedAt: session.startedAt,
    endedAt,
    assistantMode,
    transcript: session.transcript,
    asks: session.asks,
    coachMessages,
  };
}
