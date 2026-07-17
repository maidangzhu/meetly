import {
  Check,
  Loader2,
  Maximize2,
  MessageCircle,
  Minimize2,
  Plus,
  RotateCcw,
  TextQuote,
  X,
} from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  useEffect,
  useLayoutEffect,
  useReducer,
  useRef,
  type MouseEvent,
  type UIEvent,
} from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useDictation } from "./app/dictation/useDictation";
import type { DictationViewState } from "./app/dictation/types";
import { debugLog, isTauriRuntime, safeInvoke } from "./app/platform";
import type { VoiceAskConversationState, VoiceAskViewState } from "./app/voiceAsk/types";
import {
  createVoiceOverlayPresentationState,
  voiceOverlayPresentationReducer,
  type VoiceOverlayPresentationMode,
} from "./app/voiceOverlay/presentation";
import { isNearScrollBottom } from "./app/voiceOverlay/autoScroll";
import type { AssistantSuggestion } from "./app/types";
import { useVoiceAsk } from "./app/voiceAsk/useVoiceAsk";
import { AudioBars } from "./components/AudioBars";

const COMPACT_OVERLAY_WIDTH = 320;
const COMPACT_OVERLAY_HEIGHT = 68;
const ANSWER_OVERLAY_WIDTH = 480;
const ANSWER_OVERLAY_HEIGHT = 300;
const ANSWER_PANEL_HEIGHT = ANSWER_OVERLAY_HEIGHT - 20;
const FOLLOWUP_PILL_HEIGHT = 48;
const FOLLOWUP_PILL_GAP = 8;
const FOLLOWUP_OVERLAY_HEIGHT =
  ANSWER_OVERLAY_HEIGHT + FOLLOWUP_PILL_HEIGHT + FOLLOWUP_PILL_GAP;
const EXPANDED_OVERLAY_WIDTH = 720;
const EXPANDED_OVERLAY_HEIGHT = 680;

export function VoiceOverlayApp() {
  const dictation = useDictation();
  const voiceAsk = useVoiceAsk();
  const dictationPreviewPhase = import.meta.env.DEV
    ? new URLSearchParams(window.location.search).get("dictation")
    : null;
  const dictationPreviewRetryable = import.meta.env.DEV
    ? new URLSearchParams(window.location.search).get("retryable") === "true"
    : false;
  const voiceAskPreviewPhase = import.meta.env.DEV
    ? new URLSearchParams(window.location.search).get("voiceAsk")
    : null;
  const voiceAskPreviewPresentation = import.meta.env.DEV
    ? new URLSearchParams(window.location.search).get("presentation")
    : null;
  const [presentation, dispatchPresentation] = useReducer(
    voiceOverlayPresentationReducer,
    voiceAskPreviewPresentation === "expanded" ? "expanded" : "compact",
    createVoiceOverlayPresentationState
  );
  const voiceAskPreviewSuggestion: AssistantSuggestion = {
    answer:
      "这段文字强调的是：选区只提供讨论背景，真正要执行的任务仍由用户当前说出的要求决定。",
    bullets: ["保留原文语义", "根据当前问题决定翻译、解释或批评"],
    clarifyingQuestion: null,
  };
  const voiceAskPreviewConversation: VoiceAskConversationState = [
    "thread",
    "followup",
    "long-thread",
  ].includes(voiceAskPreviewPhase ?? "")
    ? {
        conversationId: "voice-preview-conversation",
        context: {
          selectedText: "Context should inform the conversation without predetermining the user's intent.",
          sourceApp: "TextEdit",
          capturedAt: Date.now(),
        },
        turns: Array.from(
          { length: voiceAskPreviewPhase === "long-thread" ? 8 : 1 },
          (_, index) => ({
            id: `voice-preview-turn-${index + 1}`,
            runId: `voice-preview-turn-${index + 1}`,
            question: index === 0 ? "这段话是什么意思？" : `继续分析第 ${index + 1} 个问题。`,
            suggestion: voiceAskPreviewSuggestion,
            createdAt: Date.now() + index,
          })
        ),
        activeTurn: voiceAskPreviewPhase === "followup"
          ? {
              runId: "voice-preview-followup",
              phase: "recording",
              message: "松开 Fn 即可追问",
              question: null,
              startedAt: Date.now(),
            }
          : null,
        error: null,
        terminalPhase: null,
      }
    : voiceAsk.conversation;
  const dictationState: DictationViewState = dictationPreviewPhase
    ? {
        runId: "dictation-preview",
        phase: dictationPreviewPhase as DictationViewState["phase"],
        message: dictationPreviewPhase === "recording" ? "再次按下即可转写" : "正在转写",
        rawText: null,
        finalText: null,
        deliveryRetryable: dictationPreviewRetryable,
      }
    : dictation.state;
  const voiceAskState: VoiceAskViewState = voiceAskPreviewPhase
    ? {
        runId: "voice-ask-preview",
        phase: voiceAskPreviewPhase === "thread" || voiceAskPreviewPhase === "long-thread"
          ? "answered"
          : voiceAskPreviewPhase === "followup"
            ? "recording"
            : voiceAskPreviewPhase as VoiceAskViewState["phase"],
        message: voiceAskPreviewPhase === "recording" ? "松开 Fn 即可提问" : "Thinking...",
        question: ["answered", "thread", "long-thread"].includes(voiceAskPreviewPhase ?? "")
          ? "如何把一个复杂问题讲清楚？"
          : null,
        suggestion: voiceAskPreviewPhase === "thread" || voiceAskPreviewPhase === "long-thread"
          ? voiceAskPreviewSuggestion
          : voiceAskPreviewPhase === "answered"
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
  const activeVoiceRunId = voiceAskPreviewConversation.activeTurn?.runId ?? null;
  const presentationMode: VoiceOverlayPresentationMode = dictationVisible
    ? "compact"
    : voiceAskVisible || presentation.mode === "expanded"
      ? presentation.mode
      : "hidden";
  const visible = presentationMode !== "hidden";
  const voiceAskHasAnswer =
    voiceAskPreviewConversation.turns.length > 0 ||
    voiceAskState.phase === "answered" ||
    voiceAskState.phase === "error";
  const voiceAskHasActiveFollowup =
    voiceAskPreviewConversation.turns.length > 0 &&
    voiceAskPreviewConversation.activeTurn !== null;
  const width = presentationMode === "expanded"
    ? EXPANDED_OVERLAY_WIDTH
    : voiceAskVisible && voiceAskHasAnswer
      ? ANSWER_OVERLAY_WIDTH
      : COMPACT_OVERLAY_WIDTH;
  const height = presentationMode === "expanded"
    ? EXPANDED_OVERLAY_HEIGHT
    : voiceAskVisible && voiceAskHasActiveFollowup
      ? FOLLOWUP_OVERLAY_HEIGHT
      : voiceAskVisible && voiceAskHasAnswer
        ? ANSWER_OVERLAY_HEIGHT
        : COMPACT_OVERLAY_HEIGHT;

  useEffect(() => {
    if (activeVoiceRunId) {
      dispatchPresentation({ type: "reopen" });
    }
  }, [activeVoiceRunId]);

  useEffect(() => {
    if (dictationVisible) {
      dispatchPresentation({ type: "hide" });
    }
  }, [dictationVisible]);

  useEffect(() => {
    void safeInvoke("set_voice_overlay_presentation_mode", {
      presentationMode,
      width,
      height,
    }).catch((error) => {
      debugLog(
        `[voice-overlay] update failed message=${error instanceof Error ? error.message : String(error)}`
      );
    });
  }, [height, presentationMode, width]);

  if (!visible) {
    return null;
  }

  const hideVoiceAsk = () => {
    dispatchPresentation({ type: "hide" });
    voiceAsk.close();
  };

  return (
    <main className="flex h-screen w-screen items-start justify-center overflow-hidden bg-transparent">
      <div className="relative h-full w-full p-2.5">
        {!dictationVisible && (voiceAskVisible || presentationMode === "expanded") ? (
          <VoiceAskOverlay
            state={voiceAskState}
            conversation={voiceAskPreviewConversation}
            audioLevel={voiceAskPreviewPhase ? 0.68 : voiceAsk.audioLevel}
            presentationMode={presentationMode === "expanded" ? "expanded" : "compact"}
            cancel={voiceAsk.close}
            expand={() => dispatchPresentation({ type: "expand" })}
            collapse={() => dispatchPresentation({ type: "collapse" })}
            hide={hideVoiceAsk}
            newConversation={voiceAsk.newConversation}
          />
        ) : (
          <DictationBubble
            state={dictationState}
            audioLevel={dictationPreviewPhase ? 0.68 : dictation.audioLevel}
            cancel={dictation.cancel}
            dismissDelivery={dictation.dismissDelivery}
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
  conversation,
  audioLevel,
  presentationMode,
  cancel,
  expand,
  collapse,
  hide,
  newConversation,
}: {
  state: VoiceAskViewState;
  conversation: VoiceAskConversationState;
  audioLevel: number;
  presentationMode: "compact" | "expanded";
  cancel: () => void;
  expand: () => void;
  collapse: () => void;
  hide: () => void;
  newConversation: () => void;
}) {
  const isThinking = state.phase === "transcribing" || state.phase === "thinking";

  if (presentationMode === "expanded") {
    return (
      <ExpandedVoiceAskPanel
        state={state}
        conversation={conversation}
        audioLevel={audioLevel}
        collapse={collapse}
        hide={hide}
        newConversation={newConversation}
      />
    );
  }

  if (conversation.turns.length > 0) {
    return (
      <VoiceAskConversationPanel
        conversation={conversation}
        audioLevel={audioLevel}
        expand={expand}
        hide={hide}
      />
    );
  }

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
        <header
          className="flex h-12 shrink-0 cursor-grab select-none items-center gap-2 border-b border-white/[0.08] px-3.5 active:cursor-grabbing"
          onMouseDown={startVoiceOverlayDrag}
        >
          <MessageCircle className="h-4 w-4 text-[#c99575]" />
          <span className="text-[13px] font-semibold text-white/82">Ask AI</span>
          <button
            type="button"
            className="voice-icon-button ml-auto"
            title="展开"
            aria-label="展开回答"
            onMouseDown={stopVoiceOverlayDrag}
            onClick={expand}
          >
            <Maximize2 />
          </button>
          <button
            type="button"
            className="voice-icon-button"
            title="关闭"
            aria-label="关闭回答"
            onMouseDown={stopVoiceOverlayDrag}
            onClick={hide}
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
              {state.suggestion && <SuggestionContent suggestion={state.suggestion} />}
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
      <span className="voice-icon-status" title={state.message ?? undefined}>
        <MessageCircle />
      </span>
    </section>
  );
}

function VoiceAskConversationPanel({
  conversation,
  audioLevel,
  expand,
  hide,
}: {
  conversation: VoiceAskConversationState;
  audioLevel: number;
  expand: () => void;
  hide: () => void;
}) {
  const conversationScroll = useVoiceConversationAutoScroll(conversation);

  return (
    <div className="relative h-full w-full">
      <section
        className="absolute inset-x-0 top-0 flex w-full flex-col overflow-hidden rounded-lg border border-white/[0.12] bg-[rgb(24_24_26_/_0.96)] backdrop-blur-2xl"
        style={{ height: ANSWER_PANEL_HEIGHT }}
        aria-label="AI 对话"
        aria-live="polite"
      >
        <header
          className="flex h-12 shrink-0 cursor-grab select-none items-center gap-2 border-b border-white/[0.08] px-3.5 active:cursor-grabbing"
          onMouseDown={startVoiceOverlayDrag}
        >
          <MessageCircle className="h-4 w-4 text-[#c99575]" />
          <span className="text-[13px] font-semibold text-white/82">Ask AI</span>
          <span className="text-[10px] text-white/32">{conversation.turns.length} 轮</span>
          <button
            type="button"
            className="voice-icon-button ml-auto"
            title="展开"
            aria-label="展开对话"
            onMouseDown={stopVoiceOverlayDrag}
            onClick={expand}
          >
            <Maximize2 />
          </button>
          <button
            type="button"
            className="voice-icon-button"
            title="关闭"
            aria-label="关闭对话"
            onMouseDown={stopVoiceOverlayDrag}
            onClick={hide}
          >
            <X />
          </button>
        </header>

        <div
          ref={conversationScroll.ref}
          className="min-h-0 flex-1 overflow-y-auto px-4 py-3.5"
          data-testid="voice-conversation-scroll-compact"
          onScroll={conversationScroll.onScroll}
        >
          {conversation.context && (
            <div className="mb-3 border-l-2 border-[#c99575]/45 pl-3 text-[11px] leading-relaxed text-white/46">
              <div className="mb-1 flex items-center gap-1.5 text-[10px] text-white/32">
                <TextQuote className="h-3 w-3" />
                <span>{conversation.context.sourceApp ?? "所选文本"}</span>
              </div>
              <p className="m-0 line-clamp-3" title={conversation.context.selectedText}>
                {conversation.context.selectedText}
              </p>
            </div>
          )}

          {conversation.turns.map((turn, index) => (
            <article
              key={turn.id}
              className={index > 0 ? "mt-4 border-t border-white/[0.08] pt-4" : undefined}
            >
              <p className="m-0 mb-2 text-[11px] leading-relaxed text-white/38">
                {turn.question}
              </p>
              <SuggestionContent suggestion={turn.suggestion} />
            </article>
          ))}
        </div>

        {conversation.error && (
          <div className="shrink-0 border-t border-white/[0.08] px-3.5 py-2 text-[11px] text-[#ff9ba8]">
            {conversation.error.message}
          </div>
        )}
      </section>

      {conversation.activeTurn && (
        <div
          className="absolute left-1/2 flex -translate-x-1/2 items-center justify-center rounded-full border border-white/[0.13] bg-[rgb(20_21_22_/_0.97)] px-5 shadow-[0_10px_28px_rgb(0_0_0_/_0.32),inset_0_1px_0_rgb(255_255_255_/_0.04)] backdrop-blur-2xl"
          style={{
            top: ANSWER_PANEL_HEIGHT + FOLLOWUP_PILL_GAP,
            width: 188,
            height: FOLLOWUP_PILL_HEIGHT,
          }}
          aria-label={
            conversation.activeTurn.phase === "recording" ? "正在录制追问" : "正在处理追问"
          }
          aria-live="polite"
        >
          {conversation.activeTurn.phase === "recording" ? (
            <div className="w-24">
              <AudioBars level={audioLevel} tone="warm" variant="compact" />
            </div>
          ) : (
            <Loader2 className="h-4 w-4 animate-spin text-[#c99575]" />
          )}
        </div>
      )}
    </div>
  );
}

function ExpandedVoiceAskPanel({
  state,
  conversation,
  audioLevel,
  collapse,
  hide,
  newConversation,
}: {
  state: VoiceAskViewState;
  conversation: VoiceAskConversationState;
  audioLevel: number;
  collapse: () => void;
  hide: () => void;
  newConversation: () => void;
}) {
  const activeTurn = conversation.activeTurn;
  const isRecording = activeTurn?.phase === "recording";
  const isProcessing = activeTurn !== null && !isRecording;
  const showStandaloneAnswer = conversation.turns.length === 0 && state.suggestion !== null;
  const conversationScroll = useVoiceConversationAutoScroll(conversation, state.suggestion?.answer);

  return (
    <section
      className="flex h-full min-h-0 w-full flex-col overflow-hidden rounded-lg border border-white/[0.12] bg-[rgb(20_21_22_/_0.98)] shadow-[0_24px_70px_rgb(0_0_0_/_0.42)] backdrop-blur-2xl"
      aria-label="Ask AI 对话应用"
      aria-live="polite"
    >
      <header
        className="flex h-13 shrink-0 cursor-grab select-none items-center gap-2 border-b border-white/[0.08] bg-white/[0.018] px-4 active:cursor-grabbing"
        onMouseDown={startVoiceOverlayDrag}
      >
        <MessageCircle className="h-4 w-4 shrink-0 text-[#c99575]" />
        <span className="truncate text-[13px] font-semibold text-white/84">Ask AI</span>
        {conversation.turns.length > 0 && (
          <span className="shrink-0 text-[10px] text-white/32">
            {conversation.turns.length} 轮
          </span>
        )}
        <div className="ml-auto flex shrink-0 items-center gap-1">
          <button
            type="button"
            className="voice-icon-button"
            title="新对话"
            aria-label="新对话"
            disabled={activeTurn !== null}
            onMouseDown={stopVoiceOverlayDrag}
            onClick={newConversation}
          >
            <Plus />
          </button>
          <button
            type="button"
            className="voice-icon-button"
            title="收起"
            aria-label="收起为紧凑面板"
            onMouseDown={stopVoiceOverlayDrag}
            onClick={collapse}
          >
            <Minimize2 />
          </button>
          <button
            type="button"
            className="voice-icon-button"
            title="关闭"
            aria-label="关闭对话窗口"
            onMouseDown={stopVoiceOverlayDrag}
            onClick={hide}
          >
            <X />
          </button>
        </div>
      </header>

      <div
        ref={conversationScroll.ref}
        className="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-7 sm:py-6"
        data-testid="voice-conversation-scroll-expanded"
        onScroll={conversationScroll.onScroll}
      >
        <div className="mx-auto w-full max-w-[680px]">
          {conversation.context && (
            <div className="mb-5 border-l-2 border-[#c99575]/45 pl-3 text-[12px] leading-relaxed text-white/48">
              <div className="mb-1.5 flex items-center gap-1.5 text-[10px] text-white/32">
                <TextQuote className="h-3 w-3" />
                <span>{conversation.context.sourceApp ?? "所选文本"}</span>
              </div>
              <p className="m-0 line-clamp-4" title={conversation.context.selectedText}>
                {conversation.context.selectedText}
              </p>
            </div>
          )}

          {conversation.turns.map((turn, index) => (
            <article
              key={turn.id}
              className={index > 0 ? "mt-6 border-t border-white/[0.08] pt-6" : undefined}
            >
              <p className="m-0 mb-3 text-[12px] leading-relaxed text-white/42">
                {turn.question}
              </p>
              <SuggestionContent suggestion={turn.suggestion} />
            </article>
          ))}

          {showStandaloneAnswer && (
            <article>
              {state.question && (
                <p className="m-0 mb-3 text-[12px] leading-relaxed text-white/42">
                  {state.question}
                </p>
              )}
              <SuggestionContent suggestion={state.suggestion!} />
            </article>
          )}

          {conversation.turns.length === 0 && !showStandaloneAnswer && !activeTurn && !conversation.error && (
            <div className="flex min-h-64 items-center justify-center text-white/20">
              <MessageCircle className="h-7 w-7" aria-hidden="true" />
            </div>
          )}

          {conversation.error && (
            <p className="m-0 rounded-md border border-[#ff7d8d]/20 bg-[#ff7d8d]/[0.06] px-3 py-2.5 text-[12px] leading-relaxed text-[#ff9ba8]">
              {conversation.error.message}
            </p>
          )}
        </div>
      </div>

      <footer className="flex h-16 shrink-0 items-center border-t border-white/[0.08] bg-black/[0.08] px-5">
        <div className="mx-auto flex h-10 w-full max-w-[680px] items-center justify-center rounded-md border border-white/[0.09] bg-white/[0.025] px-3">
          {isRecording ? (
            <div className="w-28">
              <AudioBars level={audioLevel} tone="warm" variant="compact" />
            </div>
          ) : isProcessing ? (
            <Loader2 className="h-4 w-4 animate-spin text-[#c99575]" />
          ) : (
            <MessageCircle className="h-4 w-4 text-white/28" aria-hidden="true" />
          )}
        </div>
      </footer>
    </section>
  );
}

function useVoiceConversationAutoScroll(
  conversation: VoiceAskConversationState,
  standaloneAnswer?: string
) {
  const ref = useRef<HTMLDivElement | null>(null);
  const shouldFollowRef = useRef(true);
  const latestAnswer = conversation.turns[conversation.turns.length - 1]?.suggestion.answer;

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element || !shouldFollowRef.current) return;
    element.scrollTop = element.scrollHeight;
  }, [
    conversation.turns.length,
    latestAnswer,
    standaloneAnswer,
    conversation.activeTurn?.phase,
    conversation.error?.message,
  ]);

  const onScroll = (event: UIEvent<HTMLDivElement>) => {
    shouldFollowRef.current = isNearScrollBottom(event.currentTarget);
  };

  return { ref, onScroll };
}

async function startVoiceOverlayDrag(event: MouseEvent<HTMLElement>) {
  if (event.button !== 0 || !isTauriRuntime()) return;
  event.preventDefault();

  try {
    await getCurrentWindow().startDragging();
    await safeInvoke("mark_voice_overlay_manually_positioned");
  } catch (error) {
    debugLog(
      `[voice-overlay] drag failed message=${error instanceof Error ? error.message : String(error)}`
    );
  }
}

function stopVoiceOverlayDrag(event: MouseEvent<HTMLElement>) {
  event.stopPropagation();
}

function SuggestionContent({ suggestion }: { suggestion: AssistantSuggestion }) {
  return (
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
          {suggestion.answer}
        </ReactMarkdown>
      </div>
      {suggestion.bullets.length > 0 && (
        <ul className="mt-3 grid gap-1.5 pl-4 text-[12px] leading-relaxed text-white/62">
          {suggestion.bullets.map((bullet, index) => (
            <li key={`${bullet}-${index}`}>{bullet}</li>
          ))}
        </ul>
      )}
      {suggestion.clarifyingQuestion && (
        <p className="mt-3 mb-0 border-t border-white/[0.08] pt-3 text-[12px] leading-relaxed text-white/58">
          {suggestion.clarifyingQuestion}
        </p>
      )}
    </>
  );
}

function DictationBubble({
  state,
  audioLevel,
  cancel,
  dismissDelivery,
  finishRecording,
  retryPaste,
}: {
  state: DictationViewState;
  audioLevel: number;
  cancel: () => void;
  dismissDelivery: () => void;
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

  if (state.phase === "delivery_failed" || (state.phase === "copied" && state.deliveryRetryable)) {
    const copiedFallback = state.phase === "copied";
    return (
      <section
        className="voice-surface flex h-12 w-full select-none items-center gap-2 p-2"
        aria-label={copiedFallback ? "语音输入已复制" : "语音输入写入失败"}
        aria-live={copiedFallback ? "polite" : "assertive"}
      >
        <button
          type="button"
          className="voice-toolbar-button"
          title="关闭"
          aria-label="关闭语音输入结果"
          onClick={dismissDelivery}
        >
          <X />
        </button>
        <span
          className={copiedFallback
            ? "min-w-0 flex-1 truncate text-center text-[12px] font-medium text-[#64e594]"
            : "min-w-0 flex-1 truncate text-center text-[12px] font-medium text-[#e2a2a7]"}
          title={state.message ?? undefined}
        >
          {copiedFallback ? "已复制，可重试粘贴" : "写入剪贴板失败"}
        </span>
        {state.deliveryRetryable && (
          <button
            type="button"
            className="voice-icon-button voice-icon-button--primary"
            title="重试粘贴"
            aria-label="重试粘贴"
            onClick={retryPaste}
          >
            <RotateCcw />
          </button>
        )}
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
      return "完成";
    case "copied":
      return "已复制";
    case "delivery_failed":
      return "写入失败";
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
