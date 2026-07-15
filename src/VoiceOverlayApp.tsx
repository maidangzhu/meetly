import { Check, Loader2, MessageCircle, RotateCcw, X } from "lucide-react";
import { useEffect } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useDictation } from "./app/dictation/useDictation";
import type { DictationViewState } from "./app/dictation/types";
import { debugLog, safeInvoke } from "./app/platform";
import type { VoiceAskViewState } from "./app/voiceAsk/types";
import { useVoiceAsk } from "./app/voiceAsk/useVoiceAsk";
import { AudioBars } from "./components/AudioBars";

const COMPACT_OVERLAY_WIDTH = 320;
const COMPACT_OVERLAY_HEIGHT = 68;
const ANSWER_OVERLAY_WIDTH = 480;
const ANSWER_OVERLAY_HEIGHT = 300;

export function VoiceOverlayApp() {
  const dictation = useDictation();
  const voiceAsk = useVoiceAsk();
  const dictationPreviewPhase = import.meta.env.DEV
    ? new URLSearchParams(window.location.search).get("dictation")
    : null;
  const voiceAskPreviewPhase = import.meta.env.DEV
    ? new URLSearchParams(window.location.search).get("voiceAsk")
    : null;
  const dictationState: DictationViewState = dictationPreviewPhase
    ? {
        runId: "dictation-preview",
        phase: dictationPreviewPhase as DictationViewState["phase"],
        message: dictationPreviewPhase === "recording" ? "再次按下即可转写" : "正在转写",
        rawText: null,
        finalText: null,
      }
    : dictation.state;
  const voiceAskState: VoiceAskViewState = voiceAskPreviewPhase
    ? {
        runId: "voice-ask-preview",
        phase: voiceAskPreviewPhase as VoiceAskViewState["phase"],
        message: voiceAskPreviewPhase === "recording" ? "松开 Fn 即可提问" : "Thinking...",
        question: voiceAskPreviewPhase === "answered" ? "如何把一个复杂问题讲清楚？" : null,
        suggestion: voiceAskPreviewPhase === "answered"
          ? {
              answer:
                "## 核心结论\n\n先给结论，再解释判断依据，最后用一个具体例子说明它如何落地。\n\n- 一句话说清核心判断\n- 用 `Fn` 快速提问\n\n> 只保留真正支持结论的证据。",
              bullets: ["一句话说清核心判断", "只保留支持结论的关键证据", "用例子收尾"],
              clarifyingQuestion: null,
            }
          : null,
      }
    : voiceAsk.state;
  const dictationVisible = dictationState.phase !== "idle";
  const voiceAskVisible = voiceAskState.phase !== "idle";
  const visible = voiceAskVisible || dictationVisible;
  const voiceAskHasAnswer = voiceAskState.phase === "answered" || voiceAskState.phase === "error";
  const width = voiceAskVisible && voiceAskHasAnswer
    ? ANSWER_OVERLAY_WIDTH
    : COMPACT_OVERLAY_WIDTH;
  const height = voiceAskVisible && voiceAskHasAnswer
    ? ANSWER_OVERLAY_HEIGHT
    : COMPACT_OVERLAY_HEIGHT;

  useEffect(() => {
    void safeInvoke("set_voice_overlay_mode", { visible, width, height }).catch((error) => {
      debugLog(
        `[voice-overlay] update failed message=${error instanceof Error ? error.message : String(error)}`
      );
    });
  }, [height, visible, width]);

  if (!visible) {
    return null;
  }

  return (
    <main className="flex h-screen w-screen items-start justify-center overflow-hidden bg-transparent">
      <div className="relative h-full w-full p-2.5">
        {voiceAskVisible ? (
          <VoiceAskOverlay
            state={voiceAskState}
            audioLevel={voiceAskPreviewPhase ? 0.68 : voiceAsk.audioLevel}
            close={voiceAsk.close}
          />
        ) : (
          <DictationBubble
            state={dictationState}
            audioLevel={dictationPreviewPhase ? 0.68 : dictation.audioLevel}
            cancel={dictation.cancel}
            dismissFailure={dictation.dismissFailure}
            finishRecording={dictation.finishRecording}
            retryPaste={dictation.retryPaste}
          />
        )}
      </div>
    </main>
  );
}

function VoiceAskOverlay({
  state,
  audioLevel,
  close,
}: {
  state: VoiceAskViewState;
  audioLevel: number;
  close: () => void;
}) {
  const isThinking = state.phase === "transcribing" || state.phase === "thinking";

  if (isThinking) {
    return (
      <section
        className="voice-surface flex h-12 w-full select-none items-center justify-center gap-2 px-3"
        aria-label="AI 正在思考"
        aria-live="polite"
      >
        <Loader2 className="h-3.5 w-3.5 animate-spin text-[#b9c6cc]" />
        <span className="text-[12px] font-medium text-white/62">思考中</span>
      </section>
    );
  }

  if (state.phase === "answered" || state.phase === "error") {
    return (
      <section
        className="flex h-full w-full flex-col overflow-hidden rounded-lg border border-white/[0.12] bg-[rgb(24_24_26_/_0.96)] backdrop-blur-2xl"
        aria-label="AI 回答"
        aria-live="polite"
      >
        <header className="flex h-12 shrink-0 items-center gap-2 border-b border-white/[0.08] px-3.5">
          <MessageCircle className="h-4 w-4 text-[#c99575]" />
          <span className="text-[13px] font-semibold text-white/82">Ask AI</span>
          <button
            type="button"
            className="voice-icon-button ml-auto"
            title="关闭"
            aria-label="关闭回答"
            onClick={close}
          >
            <X />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3.5">
          {state.question && (
            <p className="m-0 mb-3 line-clamp-2 text-[11px] leading-relaxed text-white/38">
              {state.question}
            </p>
          )}
          {state.phase === "error" ? (
            <p className="m-0 text-[13px] leading-relaxed text-[#ff9ba8]">{state.message}</p>
          ) : (
            <>
              <div className="voice-answer-markdown">
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  components={{
                    a: ({ children, href }) => (
                      <a href={href} target="_blank" rel="noreferrer">
                        {children}
                      </a>
                    ),
                  }}
                >
                  {state.suggestion?.answer ?? ""}
                </ReactMarkdown>
              </div>
              {state.suggestion && state.suggestion.bullets.length > 0 && (
                <ul className="mt-3 grid gap-1.5 pl-4 text-[12px] leading-relaxed text-white/62">
                  {state.suggestion.bullets.map((bullet, index) => (
                    <li key={`${bullet}-${index}`}>{bullet}</li>
                  ))}
                </ul>
              )}
              {state.suggestion?.clarifyingQuestion && (
                <p className="mt-3 mb-0 border-t border-white/[0.08] pt-3 text-[12px] leading-relaxed text-white/58">
                  {state.suggestion.clarifyingQuestion}
                </p>
              )}
            </>
          )}
        </div>
      </section>
    );
  }

  if (state.phase === "cancelled") {
    return (
      <section className="voice-surface flex h-12 w-full items-center justify-center px-3">
        <span className="text-[12px] font-medium text-white/48">已取消</span>
      </section>
    );
  }

  return (
    <section
      className="voice-surface flex h-12 w-full select-none items-center gap-2 p-2"
      aria-label="语音提问"
    >
      <button
        type="button"
        className="voice-icon-button voice-icon-button--danger"
        title="取消语音提问"
        aria-label="取消语音提问"
        onClick={close}
      >
        <X />
      </button>
      <div className="flex min-w-0 flex-1 items-center justify-center" aria-live="polite">
        {state.phase === "recording" ? (
          <AudioBars level={audioLevel} tone="warm" variant="compact" />
        ) : (
          <span className="text-[12px] font-medium text-white/62">准备中</span>
        )}
      </div>
      <span className="voice-icon-status" title={state.message ?? undefined}>
        <MessageCircle />
      </span>
    </section>
  );
}

function DictationBubble({
  state,
  audioLevel,
  cancel,
  dismissFailure,
  finishRecording,
  retryPaste,
}: {
  state: DictationViewState;
  audioLevel: number;
  cancel: () => void;
  dismissFailure: () => void;
  finishRecording: () => void;
  retryPaste: () => void;
}) {
  const isThinking = ["transcribing", "polishing", "pasting"].includes(state.phase);
  const isTerminal = ["completed", "copied", "cancelled", "error", "blocked"].includes(
    state.phase
  );
  const isSuccess = state.phase === "completed" || state.phase === "copied";

  if (isThinking) {
    return (
      <section
        className="voice-surface flex h-12 w-full select-none items-center justify-center gap-2 px-3"
        aria-label="正在处理语音输入"
        aria-live="polite"
      >
        <Loader2 className="h-3.5 w-3.5 animate-spin text-[#b9c6cc]" />
        <span className="text-[12px] font-medium text-white/62">{dictationPhaseLabel(state.phase)}</span>
      </section>
    );
  }

  if (state.phase === "paste_failed") {
    return (
      <section
        className="voice-surface flex h-12 w-full select-none items-center gap-2 p-2"
        aria-label="语音输入粘贴失败"
        aria-live="assertive"
      >
        <button
          type="button"
          className="voice-toolbar-button"
          title="关闭"
          aria-label="关闭粘贴失败提示"
          onClick={dismissFailure}
        >
          <X />
        </button>
        <span
          className="min-w-0 flex-1 truncate text-center text-[12px] font-medium text-[#e2a2a7]"
          title={state.message ?? undefined}
        >
          已失败
        </span>
        <button
          type="button"
          className="voice-icon-button voice-icon-button--primary"
          title="重试粘贴"
          aria-label="重试粘贴"
          onClick={retryPaste}
        >
          <RotateCcw />
        </button>
      </section>
    );
  }

  if (isTerminal) {
    return (
      <section
        className="voice-surface flex h-12 w-full select-none items-center justify-center gap-2 px-3"
        aria-label="语音输入结果"
        aria-live="polite"
      >
        {isSuccess && <Check className="h-4 w-4 text-[#64e594]" />}
        <span className="max-w-[220px] truncate text-[12px] font-medium text-white/62">
          {dictationPhaseLabel(state.phase)}
        </span>
      </section>
    );
  }

  return (
    <section
      className="voice-surface flex h-12 w-full select-none items-center gap-2 p-2"
      aria-label="语音输入"
    >
      <button
        type="button"
        className="voice-icon-button voice-icon-button--danger disabled:opacity-35"
        title="取消语音输入"
        aria-label="取消语音输入"
        disabled={isTerminal}
        onClick={cancel}
      >
        <X />
      </button>

      <div className="flex min-w-0 flex-1 items-center justify-center" aria-live="polite">
        {state.phase === "recording" ? (
          <AudioBars level={audioLevel} tone="warm" variant="compact" />
        ) : (
          <span className="text-[12px] font-medium text-white/62">准备中</span>
        )}
      </div>

      <button
        type="button"
        className="voice-icon-button voice-icon-button--primary disabled:bg-white/[0.08] disabled:text-white/30"
        title="完成录音"
        aria-label="完成录音"
        onClick={finishRecording}
      >
        <Check />
      </button>
    </section>
  );
}

function dictationPhaseLabel(phase: DictationViewState["phase"]) {
  switch (phase) {
    case "opening_microphone":
      return "准备中";
    case "recording":
      return "录音中";
    case "transcribing":
      return "转写中";
    case "polishing":
      return "整理中";
    case "pasting":
      return "写入中";
    case "completed":
    case "copied":
      return "完成";
    case "paste_failed":
      return "已失败";
    case "cancelled":
      return "已取消";
    case "blocked":
      return "暂不可用";
    case "error":
      return "失败";
    default:
      return "待机";
  }
}
