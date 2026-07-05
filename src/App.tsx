import {
  ChevronDown,
  Eye,
  EyeOff,
  GripVertical,
  Loader2,
  MessageSquare,
  Mic,
  MicOff,
  Settings as SettingsIcon,
  Sparkles,
  X,
} from "lucide-react";
import {
  CARD_SURFACE,
  DRAG_CURSOR,
  GHOST_ICON_BUTTON,
  SESSION_BUTTON,
  STEALTH_STATUS_BUTTON,
} from "./app/constants";
import { questionKindLabel } from "./app/interviewLogic";
import { useAssistantAsk } from "./app/useAssistantAsk";
import { useAutoAssist } from "./app/useAutoAssist";
import { useMeetlyState } from "./app/useMeetlyState";
import { useMicMeeting } from "./app/useMicMeeting";
import { usePiCoach } from "./app/usePiCoach";
import { useSessionActions } from "./app/useSessionActions";
import { useTauriEvents } from "./app/useTauriEvents";
import { useWindowActions } from "./app/useWindowActions";
import { AssistantPreview } from "./components/AssistantPreview";
import { AudioBars } from "./components/AudioBars";

export function App() {
  const ctx = useMeetlyState();
  const session = useSessionActions(ctx);
  const windowActions = useWindowActions(ctx);
  const piCoach = usePiCoach(ctx);
  const autoAssist = useAutoAssist(ctx, session);
  const mic = useMicMeeting(ctx, autoAssist, session, windowActions);
  const assistant = useAssistantAsk(ctx, session, windowActions, mic.flushCurrentMicSegment);

  useTauriEvents(ctx, autoAssist, piCoach, session);

  if (ctx.isHidden) {
    return (
      <div className="flex h-screen w-screen items-start justify-center overflow-hidden bg-transparent pointer-events-none">
        <button
          className="pointer-events-auto mt-2 rounded-xl border border-white/10 bg-[rgb(27_27_28_/_0.82)] px-3 py-2 text-white"
          onClick={windowActions.toggleHidden}
        >
          Show
        </button>
      </div>
    );
  }

  return (
    <main className="flex h-screen w-screen items-start justify-center overflow-hidden bg-transparent">
      <div className="relative h-full w-full p-2.5">
        {ctx.isStealthOn && (
          <div
            className="pointer-events-none absolute inset-1 rounded-[18px] border border-dashed border-[#38d879]/55 shadow-[0_0_0_1px_rgb(56_216_121_/_0.08)]"
            aria-hidden="true"
          />
        )}

        <div
          className={`relative h-full w-full origin-top transition-transform duration-150 ${
            ctx.isStealthOn ? "scale-[0.985]" : "scale-100"
          }`}
        >
          <section
            className={`flex h-[54px] w-full min-w-0 select-none items-center gap-2 rounded-xl p-2 ${CARD_SURFACE}`}
            aria-label="Interview assistant island"
          >
            <button
              className={`${SESSION_BUTTON} ${ctx.state === "listening" ? "bg-[#38d879]/20 text-[#38d879]" : ""}`}
              title={ctx.state === "listening" ? "停止面试监听" : "开启面试监听"}
              onClick={mic.toggleListening}
            >
              {ctx.state === "listening" ? <MicOff /> : <Mic />}
              <span>{ctx.state === "listening" ? "结束" : "开始"}</span>
            </button>

            <span
              className={`h-full w-1.5 shrink-0 self-stretch ${DRAG_CURSOR}`}
              onMouseDown={windowActions.startIslandDrag}
            />

            <div className="flex h-[38px] min-w-0 flex-1 items-center gap-2.5">
              {ctx.state === "listening" ? (
                <>
                  <AudioBars level={ctx.audioLevel} />
                  {ctx.autoAssistHint ? (
                    <AutoAssistChip
                      askAssistant={assistant.askAssistant}
                      dismissAutoAssistHint={session.dismissAutoAssistHint}
                      prefetchStatus={ctx.prefetchStatus}
                      hint={ctx.autoAssistHint}
                    />
                  ) : (
                    <ListeningStatusButton
                      audioLevel={ctx.audioLevel}
                      latestText={ctx.latestTranscript?.text ?? null}
                      setPanel={windowActions.setPanel}
                      statusLabel={windowActions.status.label}
                      transcriptError={ctx.transcriptError}
                    />
                  )}
                </>
              ) : (
                <IdleStatusButton setPanel={windowActions.setPanel} />
              )}
            </div>

            <button
              className={`${STEALTH_STATUS_BUTTON} ${ctx.isStealthOn ? "bg-[#38d879]/20 text-[#38d879]" : ""}`}
              title={ctx.isStealthOn ? "当前 Undetectable，点击切换为 Detectable" : "当前 Detectable，点击切换为 Undetectable"}
              aria-pressed={ctx.isStealthOn}
              onClick={windowActions.toggleStealth}
            >
              {ctx.isStealthOn ? <EyeOff /> : <Eye />}
              <span>{ctx.isStealthOn ? "Undetectable" : "Detectable"}</span>
            </button>

            <button className={GHOST_ICON_BUTTON} title="设置" onClick={windowActions.openSettings}>
              <SettingsIcon />
            </button>

            <div
              className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-transparent text-white/60 transition-[background,color,transform] duration-150 hover:bg-white/[0.14] active:scale-[0.98] [&_svg]:h-4 [&_svg]:w-4 ${DRAG_CURSOR}`}
              title="Drag island"
              aria-label="Drag island"
              onMouseDown={windowActions.startIslandDrag}
            >
              <GripVertical />
            </div>
          </section>

          {ctx.openPanel && (
            <AssistantPanel
              ctx={ctx}
              activeSessionTranscriptCount={session.activeSessionTranscriptCount}
              closePanel={() => windowActions.setPanel(null)}
              startIslandDrag={windowActions.startIslandDrag}
            />
          )}
        </div>
      </div>
    </main>
  );
}

function AutoAssistChip({
  askAssistant,
  dismissAutoAssistHint,
  hint,
  prefetchStatus,
}: {
  askAssistant: () => Promise<void>;
  dismissAutoAssistHint: () => void;
  hint: NonNullable<ReturnType<typeof useMeetlyState>["autoAssistHint"]>;
  prefetchStatus: ReturnType<typeof useMeetlyState>["prefetchStatus"];
}) {
  return (
    <div className="flex min-w-0 flex-1 items-center gap-1.5" onMouseDown={(event) => event.stopPropagation()}>
      <button
        className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-lg border border-[#38d879]/25 bg-[#38d879]/12 px-2.5 text-left text-[13px] text-[#dfffea] transition-colors duration-150 hover:bg-[#38d879]/18"
        title={hint.candidate.text}
        onClick={askAssistant}
      >
        <Sparkles className="h-[14px] w-[14px] shrink-0" />
        <span className="min-w-0 flex-1 truncate">
          {questionKindLabel(hint.candidate.kind)} · 按 Enter 获取建议
        </span>
        {prefetchStatus === "prefetching" && (
          <Loader2 className="h-[13px] w-[13px] shrink-0 animate-spin text-white/60" />
        )}
        {prefetchStatus === "ready" && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[#38d879]" />}
      </button>
      <button
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/[0.06] text-white/50 hover:bg-white/[0.12] hover:text-white/80 [&_svg]:h-3.5 [&_svg]:w-3.5"
        title="忽略提示"
        onClick={dismissAutoAssistHint}
      >
        <X />
      </button>
    </div>
  );
}

function ListeningStatusButton({
  audioLevel,
  latestText,
  setPanel,
  statusLabel,
  transcriptError,
}: {
  audioLevel: number;
  latestText: string | null;
  setPanel: (panel: "assistant") => Promise<void>;
  statusLabel: string;
  transcriptError: string | null;
}) {
  return (
    <button
      className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-lg bg-transparent px-1 text-left transition-colors duration-150 hover:bg-white/[0.06]"
      title="打开会话面板"
      onClick={() => setPanel("assistant")}
    >
      <span className="shrink-0 rounded-md bg-[#38d879]/12 px-1.5 py-0.5 text-[11px] font-medium text-[#7ff0a0]">
        {statusLabel}
      </span>
      <p className="m-0 min-w-0 flex-1 truncate text-[13px] text-white/70">
        {transcriptError
          ? `转写失败：${transcriptError}`
          : latestText ?? (audioLevel > 0.015 ? "正在通过麦克风监听面试/对话" : "正在监听，等待语音")}
      </p>
    </button>
  );
}

function IdleStatusButton({
  setPanel,
}: {
  setPanel: (panel: "assistant") => Promise<void>;
}) {
  return (
    <button
      className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-lg bg-transparent px-1 text-left transition-colors duration-150 hover:bg-white/[0.06]"
      title="打开会话面板"
      onClick={() => setPanel("assistant")}
    >
      <MessageSquare className="h-4 w-4 shrink-0 text-white/55" />
      <span className="min-w-0 flex-1 truncate text-[13px] text-white/60">
        打开会话面板
      </span>
    </button>
  );
}

function AssistantPanel({
  activeSessionTranscriptCount,
  closePanel,
  ctx,
  startIslandDrag,
}: {
  activeSessionTranscriptCount: number;
  closePanel: () => void;
  ctx: ReturnType<typeof useMeetlyState>;
  startIslandDrag: ReturnType<typeof useWindowActions>["startIslandDrag"];
}) {
  return (
    <section className="absolute bottom-2 top-[62px] flex w-full flex-col overflow-hidden rounded-xl border border-white/10 bg-[rgb(27_27_28_/_0.82)] shadow-[0_10px_18px_rgb(0_0_0_/_0.22)] backdrop-blur-3xl">
      <div className="flex h-14 items-center justify-between border-b border-white/[0.08] bg-white/[0.04] px-3 py-2.5">
        <div className={`min-w-0 flex-1 ${DRAG_CURSOR}`} onMouseDown={startIslandDrag}>
          <p className="m-0 text-[11px] text-white/60">MVP 0.1</p>
          <h1 className="m-0 text-sm leading-tight">Assistant</h1>
        </div>
        <button className={GHOST_ICON_BUTTON} onClick={closePanel}>
          <ChevronDown className="rotate-180" />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-3.5">
        <AssistantPreview
          state={ctx.state}
          transcriptHistory={ctx.transcriptHistory}
          assistantSuggestion={ctx.assistantSuggestion}
          assistantDraft={ctx.assistantDraft}
          assistantError={ctx.assistantError}
          isAsking={ctx.isAsking}
          coachMessages={ctx.coachMessages}
          coachDraft={ctx.coachDraft}
          isCoachThinking={ctx.isCoachThinking}
          activeSessionTranscriptCount={activeSessionTranscriptCount}
          autoAssistHint={ctx.autoAssistHint}
          prefetchStatus={ctx.prefetchStatus}
        />
      </div>
    </section>
  );
}
