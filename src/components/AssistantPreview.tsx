import { Loader2 } from "lucide-react";
import { coachTriggerLabel, questionKindLabel } from "../app/interviewLogic";
import type {
  AssistantSuggestion,
  AutoAssistHint,
  CoachMessage,
  IslandState,
  PrefetchStatus,
  TranscriptSegment,
} from "../app/types";

type AssistantPreviewProps = {
  state: IslandState;
  transcriptHistory: TranscriptSegment[];
  assistantSuggestion: AssistantSuggestion | null;
  assistantDraft: string;
  assistantError: string | null;
  isAsking: boolean;
  coachMessages: CoachMessage[];
  coachDraft: CoachMessage | null;
  isCoachThinking: boolean;
  activeSessionTranscriptCount: number;
  autoAssistHint: AutoAssistHint | null;
  prefetchStatus: PrefetchStatus;
};

export function AssistantPreview({
  state,
  transcriptHistory,
  assistantSuggestion,
  assistantDraft,
  assistantError,
  isAsking,
  coachMessages,
  coachDraft,
  isCoachThinking,
  activeSessionTranscriptCount,
  autoAssistHint,
  prefetchStatus,
}: AssistantPreviewProps) {
  return (
    <div className="grid h-full min-h-0 grid-cols-[minmax(0,1fr)_320px] gap-3">
      <div className="flex min-h-0 flex-col">
        {autoAssistHint && (
          <div className="mb-3 shrink-0 rounded-xl border border-[#38d879]/20 bg-[#38d879]/10 p-3.5">
            <p className="m-0 text-[11px] text-[#baf8cf]">
              {questionKindLabel(autoAssistHint.candidate.kind)} · confidence{" "}
              {autoAssistHint.candidate.confidence.toFixed(2)} · {prefetchStatus}
            </p>
            <p className="mt-2 text-[13px] leading-normal text-white/80">
              {autoAssistHint.candidate.text}
            </p>
          </div>
        )}

        <div className="shrink-0">
          <SuggestionCard
            assistantDraft={assistantDraft}
            assistantError={assistantError}
            assistantSuggestion={assistantSuggestion}
            isAsking={isAsking}
          />
        </div>

        <TranscriptCard transcriptHistory={transcriptHistory} />
        <p className="m-0 shrink-0 pt-2 text-[11px] text-white/60">
          Current state: {state} · Session segments: {activeSessionTranscriptCount}
        </p>
      </div>

      <CoachCard
        coachMessages={coachMessages}
        coachDraft={coachDraft}
        isCoachThinking={isCoachThinking}
      />
    </div>
  );
}

function SuggestionCard({
  assistantDraft,
  assistantError,
  assistantSuggestion,
  isAsking,
}: Pick<AssistantPreviewProps, "assistantDraft" | "assistantError" | "assistantSuggestion" | "isAsking">) {
  return (
    <div className="mb-3 max-h-[230px] overflow-auto rounded-xl border border-white/[0.08] bg-white/[0.05] p-3.5">
      <p className="m-0 text-[11px] text-white/60">建议</p>
      {isAsking ? (
        assistantDraft ? (
          <p className="mt-2 whitespace-pre-wrap text-[13px] leading-normal text-white/90">{assistantDraft}</p>
        ) : (
          <p className="mt-2 flex items-center gap-2 text-[13px] leading-normal text-white/60">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> 正在生成建议...
          </p>
        )
      ) : assistantError ? (
        <p className="mt-2 text-[13px] leading-normal text-[#ff5c70]">{assistantError}</p>
      ) : assistantSuggestion ? (
        <>
          <p className="mt-2 text-[13px] leading-normal text-white/90">{assistantSuggestion.answer}</p>
          {assistantSuggestion.bullets.length > 0 && (
            <ul className="mt-2 list-disc pl-[18px]">
              {assistantSuggestion.bullets.map((bullet, index) => (
                <li key={index} className="text-[13px] leading-normal text-white/70">{bullet}</li>
              ))}
            </ul>
          )}
          {assistantSuggestion.clarifyingQuestion && (
            <p className="mt-2 text-[13px] italic leading-normal text-white/50">
              {assistantSuggestion.clarifyingQuestion}
            </p>
          )}
        </>
      ) : (
        <p className="mt-2 text-[13px] leading-normal text-white/50">
          按 Enter 根据从开始到现在的面试/对话转写生成建议。录音和转写会继续运行。
        </p>
      )}
    </div>
  );
}

function CoachCard({
  coachMessages,
  coachDraft,
  isCoachThinking,
}: Pick<AssistantPreviewProps, "coachMessages" | "coachDraft" | "isCoachThinking">) {
  return (
    <aside className="flex min-h-0 flex-col rounded-xl border border-white/[0.08] bg-white/[0.05] p-3.5">
      <div className="flex shrink-0 items-center justify-between">
        <p className="m-0 text-[11px] text-white/60">PI 旁观者</p>
        {isCoachThinking && !coachDraft && <Loader2 className="h-3 w-3 animate-spin text-white/40" />}
      </div>
      <ul className="mt-2 flex min-h-0 flex-1 flex-col gap-2 overflow-auto pr-1">
        {coachMessages.length === 0 && !coachDraft && (
          <li className="text-[13px] leading-normal text-white/45">
            开始面试后，我会在检测到关键问题或回答完成时给短提示。
          </li>
        )}
        {coachMessages.map((message) => (
          <li key={message.id} className="rounded-lg bg-black/15 px-2.5 py-2">
            <p className="m-0 text-[11px] text-white/40">{coachTriggerLabel(message.trigger)}</p>
            <p className="mt-1 whitespace-pre-wrap text-[13px] leading-normal text-white/82">{message.text}</p>
          </li>
        ))}
        {coachDraft && (
          <li className="rounded-lg bg-[#38d879]/10 px-2.5 py-2">
            <p className="m-0 flex items-center gap-1.5 text-[11px] text-[#baf8cf]">
              <Loader2 className="h-3 w-3 animate-spin" /> {coachTriggerLabel(coachDraft.trigger)}
            </p>
            {coachDraft.text && (
              <p className="mt-1 whitespace-pre-wrap text-[13px] leading-normal text-white/82">{coachDraft.text}</p>
            )}
          </li>
        )}
      </ul>
    </aside>
  );
}

function TranscriptCard({ transcriptHistory }: Pick<AssistantPreviewProps, "transcriptHistory">) {
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-white/[0.08] bg-white/[0.05] p-3.5">
      <p className="m-0 shrink-0 text-[11px] text-white/60">最近转写</p>
      {transcriptHistory.length === 0 ? (
        <p className="mt-2 text-[13px] leading-normal text-white/50">
          还没有识别到语音。开始监听后，完整说完一句话会在这里出字。
        </p>
      ) : (
        <ul className="mt-2 flex min-h-0 flex-1 flex-col gap-1.5 overflow-auto pr-1">
          {transcriptHistory.map((segment) => (
            <li key={segment.id} className="text-[13px] leading-normal text-white/80">{segment.text}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
