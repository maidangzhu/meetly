import { Brain, Loader2, MessageCircle, Wrench } from "lucide-react";
import { useLayoutEffect, useRef, type UIEvent } from "react";
import { coachTriggerLabel, questionKindLabel } from "../app/interviewLogic";
import type {
  AssistantSuggestion,
  AutoAssistHint,
  CoachActivity,
  CoachMessage,
  CoachToolTrace,
  ContextDocument,
  PartialTranscript,
  PrefetchStatus,
  TranscriptSegment,
} from "../app/types";

type AssistantPreviewProps = {
  transcriptHistory: TranscriptSegment[];
  partialTranscript: PartialTranscript | null;
  audioLevel: number;
  isListening: boolean;
  transcriptError: string | null;
  assistantSuggestion: AssistantSuggestion | null;
  assistantDraft: string;
  assistantError: string | null;
  isAsking: boolean;
  contextDocuments: ContextDocument[];
  coachMessages: CoachMessage[];
  coachDraft: CoachMessage | null;
  coachActivity: CoachActivity | null;
  isCoachThinking: boolean;
  autoAssistHint: AutoAssistHint | null;
  prefetchStatus: PrefetchStatus;
};

export function AssistantPreview({
  transcriptHistory,
  partialTranscript,
  audioLevel,
  isListening,
  transcriptError,
  assistantSuggestion,
  assistantDraft,
  assistantError,
  isAsking,
  contextDocuments,
  coachMessages,
  coachDraft,
  coachActivity,
  isCoachThinking,
  autoAssistHint,
  prefetchStatus,
}: AssistantPreviewProps) {
  return (
    <div className="grid h-full min-h-0 grid-cols-[minmax(0,1fr)_300px] divide-x divide-white/[0.08] overflow-hidden">
      <div className="flex min-h-0 flex-col pr-4">
        {autoAssistHint && (
          <div className="mb-3 shrink-0 border-l-2 border-[#c17f59] bg-[#c17f59]/8 px-3 py-2.5">
            <p className="m-0 text-[11px] text-[#d0a083]">
              {questionKindLabel(autoAssistHint.candidate.kind)} · {prefetchStatusLabel(prefetchStatus)}
            </p>
            <p className="mt-1.5 text-[13px] leading-normal text-white/78">
              {autoAssistHint.candidate.text}
            </p>
          </div>
        )}

        <div className="shrink-0">
          <ContextDocumentsCard contextDocuments={contextDocuments} />
          <SuggestionCard
            assistantDraft={assistantDraft}
            assistantError={assistantError}
            assistantSuggestion={assistantSuggestion}
            isAsking={isAsking}
          />
        </div>

        <TranscriptCard
          audioLevel={audioLevel}
          isListening={isListening}
          partialTranscript={partialTranscript}
          transcriptError={transcriptError}
          transcriptHistory={transcriptHistory}
        />
      </div>

      <CoachCard
        coachMessages={coachMessages}
        coachDraft={coachDraft}
        coachActivity={coachActivity}
        isCoachThinking={isCoachThinking}
      />
    </div>
  );
}

function ContextDocumentsCard({ contextDocuments }: { contextDocuments: ContextDocument[] }) {
  if (contextDocuments.length === 0) {
    return null;
  }

  return (
    <div className="mb-3 flex min-h-9 items-center gap-3 border-y border-white/[0.07] py-2">
      <p className="m-0 shrink-0 text-[11px] text-white/38">资料</p>
      <div className="flex min-w-0 flex-1 flex-wrap gap-x-3 gap-y-1">
        {contextDocuments.map((document) => (
          <span
            key={document.id}
            className="inline-flex max-w-[180px] items-center text-[12px] text-white/56"
            title={document.name}
          >
            <span className="truncate">{document.name}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

function prefetchStatusLabel(status: PrefetchStatus) {
  if (status === "prefetching") return "正在准备";
  if (status === "ready") return "已准备";
  if (status === "error") return "准备失败";
  return "待处理";
}

function SuggestionCard({
  assistantDraft,
  assistantError,
  assistantSuggestion,
  isAsking,
}: Pick<AssistantPreviewProps, "assistantDraft" | "assistantError" | "assistantSuggestion" | "isAsking">) {
  return (
    <section className="mb-3 flex max-h-[220px] min-h-[122px] flex-col overflow-hidden border-b border-white/[0.08] pb-3">
      <div className="flex shrink-0 items-center justify-between">
        <p className="section-title">建议</p>
        {isAsking && <Loader2 className="h-3.5 w-3.5 animate-spin text-[#b9c6cc]" />}
      </div>
      <div className="mt-2 min-h-0 flex-1 overflow-auto overscroll-contain pr-1">
        {isAsking ? (
          assistantDraft ? (
            <p className="m-0 whitespace-pre-wrap text-[13px] leading-normal text-white/90">{assistantDraft}</p>
          ) : (
            <p className="m-0 text-[13px] leading-normal text-white/46">正在组织建议...</p>
          )
        ) : assistantError ? (
          <p className="m-0 text-[13px] leading-normal text-[#ff5c70]">{assistantError}</p>
        ) : assistantSuggestion ? (
          <>
            <p className="m-0 text-[13px] leading-normal text-white/90">{assistantSuggestion.answer}</p>
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
          <p className="m-0 text-[13px] leading-normal text-white/42">需要时，建议会出现在这里。</p>
        )}
      </div>
    </section>
  );
}

function CoachCard({
  coachActivity,
  coachMessages,
  coachDraft,
  isCoachThinking,
}: Pick<AssistantPreviewProps, "coachActivity" | "coachMessages" | "coachDraft" | "isCoachThinking">) {
  const scrollRef = useRef<HTMLUListElement | null>(null);
  const shouldFollowRef = useRef(true);

  useLayoutEffect(() => {
    scrollToBottomIfFollowing(scrollRef.current, shouldFollowRef);
  }, [coachMessages.length, coachDraft?.text, coachDraft?.toolTraces.length]);

  return (
    <aside className="flex min-h-0 flex-col pl-4">
      <div className="flex shrink-0 items-center justify-between">
        <p className="section-title">主动建议</p>
        {coachActivity ? (
          <CoachActivityPill activity={coachActivity} />
        ) : isCoachThinking && !coachDraft ? (
          <Loader2 className="h-3 w-3 animate-spin text-white/40" />
        ) : null}
      </div>
      <ul
        ref={scrollRef}
        className="mt-2 flex min-h-0 flex-1 flex-col overflow-auto overscroll-contain pr-1"
        data-testid="coach-scroll"
        onScroll={(event) => updateFollowState(event, shouldFollowRef)}
      >
        {coachMessages.length === 0 && !coachDraft && (
          <li className="border-t border-white/[0.07] py-3 text-[13px] leading-normal text-white/42">
            关键时刻的提醒会按时间顺序出现在这里。
          </li>
        )}
        {coachMessages.map((message) => (
          <li key={message.id} className="border-t border-white/[0.07] py-3">
            <p className="m-0 text-[11px] text-white/40">{coachTriggerLabel(message.trigger)}</p>
            <CoachToolTraceList traces={message.toolTraces} />
            <p className="mt-1 whitespace-pre-wrap text-[13px] leading-normal text-white/82">{message.text}</p>
          </li>
        ))}
        {coachDraft && (
          <li className="border-l-2 border-[#c17f59] bg-[#c17f59]/8 px-3 py-2.5">
            <p className="m-0 flex items-center gap-1.5 text-[11px] text-[#d0a083]">
              <Loader2 className="h-3 w-3 animate-spin" />
              {coachActivity?.label ?? coachTriggerLabel(coachDraft.trigger)}
            </p>
            {coachActivity?.detail && (
              <p className="mt-1 text-[12px] leading-normal text-white/45">{coachActivity.detail}</p>
            )}
            <CoachToolTraceList traces={coachDraft.toolTraces} />
            {coachDraft.text && (
              <p className="mt-1 whitespace-pre-wrap text-[13px] leading-normal text-white/82">{coachDraft.text}</p>
            )}
          </li>
        )}
      </ul>
    </aside>
  );
}

function CoachToolTraceList({ traces }: { traces: CoachToolTrace[] }) {
  if (traces.length === 0) {
    return null;
  }

  return (
    <div className="mt-2 border-l border-white/[0.09] pl-2.5">
      {traces.map((trace) => (
        <div
          key={trace.id}
          className="border-t border-white/[0.07] py-2 first:border-t-0"
        >
          <div className="flex items-center justify-between gap-2">
            <p className="m-0 flex min-w-0 items-center gap-1.5 text-[11px] text-white/55">
              <Wrench className="h-3 w-3 shrink-0" />
              <span className="min-w-0 truncate">{trace.label}</span>
            </p>
            <span className={`shrink-0 text-[10px] ${toolTraceStatusClass(trace.status)}`}>
              {toolTraceStatusLabel(trace.status)}
            </span>
          </div>
          {trace.query && (
            <p className="mt-1 truncate text-[11px] text-white/42">输入：{trace.query}</p>
          )}
          {trace.content && (
            <pre className="mt-1 max-h-24 overflow-auto whitespace-pre-wrap border-l border-white/[0.08] pl-2 text-[11px] leading-normal text-white/52">
              {trace.content}
            </pre>
          )}
        </div>
      ))}
    </div>
  );
}

function toolTraceStatusLabel(status: CoachToolTrace["status"]) {
  if (status === "running") return "进行中";
  if (status === "error") return "失败";
  return "完成";
}

function toolTraceStatusClass(status: CoachToolTrace["status"]) {
  if (status === "running") return "text-[#d0a083]";
  if (status === "error") return "text-[#ff7a8a]";
  return "text-white/45";
}

function CoachActivityPill({ activity }: { activity: CoachActivity }) {
  const Icon =
    activity.phase === "tool"
      ? Wrench
      : activity.phase === "speaking"
        ? MessageCircle
        : Brain;
  const isSpinning = activity.phase === "thinking" || activity.phase === "tool";

  return (
    <span className="inline-flex h-6 max-w-[180px] items-center gap-1.5 border-l-2 border-[#c17f59] pl-2 text-[11px] text-[#d0a083]">
      <Icon className={`h-3 w-3 shrink-0 ${isSpinning ? "animate-pulse" : ""}`} />
      <span className="min-w-0 truncate">{activity.label}</span>
    </span>
  );
}

function TranscriptCard({
  audioLevel,
  isListening,
  partialTranscript,
  transcriptError,
  transcriptHistory,
}: Pick<
  AssistantPreviewProps,
  "audioLevel" | "isListening" | "partialTranscript" | "transcriptError" | "transcriptHistory"
>) {
  const status = getTranscriptStatus({ audioLevel, isListening, partialTranscript, transcriptError });
  const scrollRef = useRef<HTMLUListElement | null>(null);
  const shouldFollowRef = useRef(true);

  useLayoutEffect(() => {
    scrollToBottomIfFollowing(scrollRef.current, shouldFollowRef);
  }, [partialTranscript?.text, transcriptHistory.length]);

  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex shrink-0 items-center justify-between gap-2">
        <p className="section-title">转写</p>
        <span className={`inline-flex h-6 max-w-[140px] items-center gap-1.5 border-l-2 pl-2 text-[11px] ${status.className}`}>
          {status.live && (
            <span className="h-3 w-[2px] shrink-0 bg-current opacity-70" />
          )}
          <span className="min-w-0 truncate">{status.label}</span>
        </span>
      </div>
      {transcriptHistory.length === 0 && !partialTranscript ? (
        <p className="mt-2 text-[13px] leading-normal text-white/50">
          {isListening ? "正在监听，开口后会先显示实时字幕。" : "开始监听后，完整说完一句话会在这里出字。"}
        </p>
      ) : (
        <ul
          ref={scrollRef}
          className="mt-2 flex min-h-0 flex-1 flex-col overflow-auto overscroll-contain pr-1"
          data-testid="transcript-scroll"
          onScroll={(event) => updateFollowState(event, shouldFollowRef)}
        >
          {transcriptHistory.map((segment) => (
            <li key={segment.id} className="border-t border-white/[0.07] py-2.5 text-[13px] leading-normal text-white/72 first:border-t-0">
              {segment.text}
            </li>
          ))}
          {partialTranscript && (
            <li className="border-l-2 border-[#c17f59] bg-[#c17f59]/8 px-3 py-2.5">
              <p className="m-0 flex items-center gap-1.5 text-[11px] text-[#d0a083]">
                实时转写
              </p>
              <p className="mt-1 whitespace-pre-wrap text-[14px] leading-normal text-white/90">
                {partialTranscript.text}
                <span className="ml-0.5 inline-block h-4 w-[2px] translate-y-[2px] bg-[#d0a083] [animation:transcript-caret-blink_1s_steps(2,start)_infinite]" />
              </p>
            </li>
          )}
        </ul>
      )}
    </section>
  );
}

function updateFollowState(
  event: UIEvent<HTMLElement>,
  shouldFollowRef: { current: boolean }
) {
  const element = event.currentTarget;
  shouldFollowRef.current = element.scrollHeight - element.scrollTop - element.clientHeight <= 40;
}

function scrollToBottomIfFollowing(
  element: HTMLElement | null,
  shouldFollowRef: { current: boolean }
) {
  if (!element || !shouldFollowRef.current) return;
  element.scrollTop = element.scrollHeight;
}

function getTranscriptStatus({
  audioLevel,
  isListening,
  partialTranscript,
  transcriptError,
}: Pick<AssistantPreviewProps, "audioLevel" | "isListening" | "partialTranscript" | "transcriptError">) {
  if (transcriptError) {
    return {
      className: "border-[#ff7a8a] text-[#ff9aaa]",
      label: "转写异常",
      live: false,
    };
  }

  if (partialTranscript) {
    return {
      className: "border-[#c17f59] text-[#d0a083]",
      label: "转写中",
      live: true,
    };
  }

  if (isListening && audioLevel > 0.015) {
    return {
      className: "border-[#9cafb8] text-[#b9c6cc]",
      label: "正在听",
      live: true,
    };
  }

  return {
    className: "border-white/24 text-white/42",
    label: isListening ? "等待语音" : "未开始",
    live: false,
  };
}
