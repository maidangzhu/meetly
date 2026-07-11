import {
  ArrowLeft,
  ChevronDown,
  Check,
  Eye,
  EyeOff,
  FileText,
  GripVertical,
  Loader2,
  Mic,
  MicOff,
  MonitorUp,
  PenLine,
  Settings as SettingsIcon,
  Sparkles,
  UploadCloud,
  X,
} from "lucide-react";
import { useEffect, useRef, useState, type ChangeEvent, type DragEvent, type ReactNode } from "react";
import {
  CARD_SURFACE,
  DRAG_CURSOR,
  GHOST_ICON_BUTTON,
  SESSION_BUTTON,
} from "./app/constants";
import {
  contextDocumentRoleLabel,
  readDroppedContextFiles,
  supportedContextDocumentLabel,
} from "./app/contextDocuments";
import { questionKindLabel } from "./app/interviewLogic";
import { safeInvoke } from "./app/platform";
import type { MeetingPerspective } from "./app/types";
import { useAgentRuntime } from "./app/useAgentRuntime";
import { useAssistantAsk } from "./app/useAssistantAsk";
import { useAutoAssist } from "./app/useAutoAssist";
import { useMeetlyState } from "./app/useMeetlyState";
import { useMicMeeting } from "./app/useMicMeeting";
import { useSessionActions } from "./app/useSessionActions";
import { useTauriEvents } from "./app/useTauriEvents";
import { useWindowActions } from "./app/useWindowActions";
import { AssistantPreview } from "./components/AssistantPreview";
import { AudioBars } from "./components/AudioBars";
import { SettingsContent } from "./SettingsApp";
import type { OnboardingStatus } from "./settings/OnboardingPanel";

export function App() {
  const ctx = useMeetlyState();
  const session = useSessionActions(ctx);
  const windowActions = useWindowActions(ctx);
  const agent = useAgentRuntime(ctx);
  const autoAssist = useAutoAssist(ctx, session, agent);
  const mic = useMicMeeting(ctx, agent, session, windowActions);
  const assistant = useAssistantAsk(ctx, session, windowActions, mic.flushCurrentMicSegment);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [isDraggingFile, setIsDraggingFile] = useState(false);

  useTauriEvents(ctx, autoAssist, session);

  useEffect(() => {
    let mounted = true;
    void safeInvoke<OnboardingStatus>("get_onboarding_status").then((status) => {
      if (!mounted || !status || status.completed) {
        return;
      }
      ctx.setOpenPanel("settings");
      void windowActions.resizeIsland(true);
    });

    return () => {
      mounted = false;
    };
  }, []);

  const toggleSession = () => {
    if (ctx.state === "listening") {
      void mic.toggleListening();
      return;
    }

    void windowActions.setPanel("perspective");
  };

  const openFilePicker = () => {
    fileInputRef.current?.click();
  };

  const processContextFiles = async (files: File[]) => {
    if (files.length === 0) {
      return;
    }

    ctx.setContextDocumentMessage(`正在读取 ${files.length} 个资料文件...`);
    const { documents, rejected } = await readDroppedContextFiles(files, ctx.meetingPerspective);
    session.addContextDocuments(documents);
    ctx.setContextDocumentMessage(
      [
        documents.length > 0 ? `已读取 ${documents.length} 个资料文件。` : null,
        ...rejected,
      ].filter(Boolean).join(" ")
    );
  };

  const handleDroppedFiles = async (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "copy";
    setIsDraggingFile(false);
    await processContextFiles(Array.from(event.dataTransfer.files ?? []));
  };

  const handleDragOver = (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "copy";
    if (Array.from(event.dataTransfer.types).includes("Files")) {
      setIsDraggingFile(true);
    }
  };

  const handleDragLeave = (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDraggingFile(false);
  };

  const handleFileInputChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    await processContextFiles(files);
  };

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
    <main
      className="flex h-screen w-screen items-start justify-center overflow-hidden bg-transparent"
      onDragEnter={handleDragOver}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={(event) => void handleDroppedFiles(event)}
    >
      <input
        ref={fileInputRef}
        className="hidden"
        type="file"
        multiple
        accept=".pdf,.txt,.md,.markdown,.json,.csv,.tsv,.yaml,.yml,application/pdf,text/*,application/json"
        onChange={(event) => void handleFileInputChange(event)}
      />
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
          onDragEnter={handleDragOver}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={(event) => void handleDroppedFiles(event)}
        >
          {isDraggingFile && (
            <div
              className="pointer-events-none absolute inset-0 z-50 flex items-center justify-center rounded-xl border border-[#38d879]/40 bg-[rgb(13_24_18_/_0.86)] text-[#dfffea] shadow-[0_0_0_1px_rgb(56_216_121_/_0.12)] backdrop-blur-md"
              aria-hidden="true"
            >
              <div className="flex items-center gap-2 rounded-lg bg-[#38d879]/12 px-3 py-2 text-sm font-medium">
                <UploadCloud className="h-4 w-4" />
                <span>松开上传资料</span>
              </div>
            </div>
          )}

          {ctx.openPanel === "settings" ? (
            <SettingsExpandedPanel
              closePanel={() => void windowActions.setPanel(null)}
              startIslandDrag={windowActions.startIslandDrag}
            />
          ) : ctx.openPanel === "perspective" ? (
            <PerspectivePanel
              closePanel={() => void windowActions.setPanel(null)}
              perspective={ctx.meetingPerspective}
              contextDocumentMessage={ctx.contextDocumentMessage}
              contextDocuments={ctx.contextDocuments}
              openFilePicker={openFilePicker}
              removeContextDocument={session.removeContextDocument}
              setPerspective={(perspective) => {
                ctx.setMeetingPerspective(perspective);
                ctx.setAssistantMode(perspective === "candidate" ? "interview" : "interviewer");
              }}
              startIslandDrag={windowActions.startIslandDrag}
              startMeeting={() => void mic.startMicMeeting()}
            />
          ) : (
            <IslandBar
              askAssistant={assistant.askAssistant}
              contextDocumentMessage={ctx.contextDocumentMessage}
              contextDocuments={ctx.contextDocuments}
              ctx={ctx}
              dismissAutoAssistHint={session.dismissAutoAssistHint}
              setPanel={windowActions.setPanel}
              startIslandDrag={windowActions.startIslandDrag}
              toggleSession={toggleSession}
              toggleStealth={windowActions.toggleStealth}
            />
          )}

          {ctx.openPanel === "assistant" && (
            <AssistantPanel
              ctx={ctx}
              closePanel={() => windowActions.setPanel(null)}
              startIslandDrag={windowActions.startIslandDrag}
              openFilePicker={openFilePicker}
            />
          )}
        </div>
      </div>
    </main>
  );
}

function IslandBar({
  askAssistant,
  contextDocumentMessage,
  contextDocuments,
  ctx,
  dismissAutoAssistHint,
  setPanel,
  startIslandDrag,
  toggleSession,
  toggleStealth,
}: {
  askAssistant: () => Promise<void>;
  contextDocumentMessage: string | null;
  contextDocuments: ReturnType<typeof useMeetlyState>["contextDocuments"];
  ctx: ReturnType<typeof useMeetlyState>;
  dismissAutoAssistHint: () => void;
  setPanel: ReturnType<typeof useWindowActions>["setPanel"];
  startIslandDrag: ReturnType<typeof useWindowActions>["startIslandDrag"];
  toggleSession: () => void;
  toggleStealth: () => Promise<void>;
}) {
  const perspectiveLabel = getPerspectiveLabel(ctx.meetingPerspective);

  return (
    <section
      className={`flex h-[54px] w-full min-w-0 select-none items-center gap-2 rounded-xl p-2 ${CARD_SURFACE}`}
      aria-label="Interview assistant island"
    >
      <button
        className={`${SESSION_BUTTON} ${ctx.state === "listening" ? "bg-[#38d879]/20 text-[#38d879]" : ""}`}
        title={ctx.state === "listening" ? "停止面试监听" : "选择视角并开启会议"}
        onClick={toggleSession}
      >
        {ctx.state === "listening" ? <MicOff /> : <Mic />}
        <span>{ctx.state === "listening" ? "结束" : "开始"}</span>
      </button>

      {contextDocuments.length > 0 && (
        <span
          className="inline-flex h-9 max-w-[120px] shrink-0 items-center gap-1.5 rounded-xl bg-white/[0.06] px-2 text-[12px] text-white/62"
          title={contextDocuments.map((document) => document.name).join("\n")}
        >
          <FileText className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">{contextDocuments.length} 份资料</span>
        </span>
      )}

      {contextDocumentMessage && contextDocuments.length === 0 && (
        <span className="inline-flex h-9 max-w-[160px] shrink-0 items-center rounded-xl bg-white/[0.06] px-2 text-[11px] text-white/50">
          <span className="truncate">{contextDocumentMessage}</span>
        </span>
      )}

      <button
        className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-xl border-0 bg-white/[0.06] px-2.5 text-[12px] font-medium text-white/72 transition-[background,color,transform] duration-150 hover:bg-white/[0.12] hover:text-white active:scale-[0.98] [&_svg]:h-3.5 [&_svg]:w-3.5"
        title="切换会议视角"
        onClick={() => void setPanel("perspective")}
      >
        {ctx.meetingPerspective === "candidate" ? <Sparkles /> : <PenLine />}
        <span>{perspectiveLabel}</span>
      </button>

      <span
        className={`h-full w-1.5 shrink-0 self-stretch ${DRAG_CURSOR}`}
        onMouseDown={startIslandDrag}
      />

      <div className="flex h-[38px] min-w-0 flex-1 items-center gap-2.5">
        {ctx.state === "listening" ? (
          <>
            <AudioBars level={ctx.audioLevel} />
            {ctx.autoAssistHint ? (
              <AutoAssistChip
                askAssistant={askAssistant}
                dismissAutoAssistHint={dismissAutoAssistHint}
                prefetchStatus={ctx.prefetchStatus}
                hint={ctx.autoAssistHint}
              />
            ) : (
              <ListeningStatusButton
                audioLevel={ctx.audioLevel}
                latestText={ctx.partialTranscript?.text ?? ctx.latestTranscript?.text ?? null}
                setPanel={setPanel}
                statusLabel={getListeningStatusLabel({
                  audioLevel: ctx.audioLevel,
                  hasPartialTranscript: Boolean(ctx.partialTranscript),
                  transcriptError: ctx.transcriptError,
                })}
                transcriptError={ctx.transcriptError}
              />
            )}
          </>
        ) : (
          <IdleStatusLabel />
        )}
      </div>

      <button
        className={`${GHOST_ICON_BUTTON} ${ctx.isStealthOn ? "bg-[#38d879]/20 text-[#38d879]" : ""}`}
        title={ctx.isStealthOn ? "Undetectable：点击切换为 Detectable" : "Detectable：点击切换为 Undetectable"}
        aria-label={ctx.isStealthOn ? "Undetectable" : "Detectable"}
        aria-pressed={ctx.isStealthOn}
        onClick={toggleStealth}
      >
        {ctx.isStealthOn ? <EyeOff /> : <Eye />}
      </button>

      <button className={GHOST_ICON_BUTTON} title="设置" onClick={() => void setPanel("settings")}>
        <SettingsIcon />
      </button>

      <div
        className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-transparent text-white/60 transition-[background,color,transform] duration-150 hover:bg-white/[0.14] active:scale-[0.98] [&_svg]:h-4 [&_svg]:w-4 ${DRAG_CURSOR}`}
        title="Drag island"
        aria-label="Drag island"
        onMouseDown={startIslandDrag}
      >
        <GripVertical />
      </div>
    </section>
  );
}

function PerspectivePanel({
  closePanel,
  contextDocumentMessage,
  contextDocuments,
  openFilePicker,
  perspective,
  removeContextDocument,
  setPerspective,
  startIslandDrag,
  startMeeting,
}: {
  closePanel: () => void;
  contextDocumentMessage: string | null;
  contextDocuments: ReturnType<typeof useMeetlyState>["contextDocuments"];
  openFilePicker: () => void;
  perspective: MeetingPerspective;
  removeContextDocument: (id: string) => void;
  setPerspective: (perspective: MeetingPerspective) => void;
  startIslandDrag: ReturnType<typeof useWindowActions>["startIslandDrag"];
  startMeeting: () => void;
}) {
  return (
    <section className={`flex h-full w-full flex-col overflow-hidden rounded-xl ${CARD_SURFACE}`}>
      <PanelHeader
        eyebrow="Start setup"
        title="选择会议视角"
        closePanel={closePanel}
        startIslandDrag={startIslandDrag}
      />

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <PerspectiveChoice
            description="适合候选人实时回答问题。建议会以第一人称输出，可以直接照着说或改写。"
            icon={<Sparkles />}
            isSelected={perspective === "candidate"}
            label="我是面试者"
            onSelect={() => setPerspective("candidate")}
          />
          <PerspectiveChoice
            description="适合主持技术面、产品面或行为面。建议会偏向追问、判断信号和下一轮问题。"
            icon={<PenLine />}
            isSelected={perspective === "interviewer"}
            label="我是面试官"
            onSelect={() => setPerspective("interviewer")}
          />
        </div>

        <section className="mt-4 rounded-lg border border-white/[0.08] bg-white/[0.045] p-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-white/88">
            <MonitorUp className="h-4 w-4 text-[#38d879]" />
            <span>{getPerspectiveLabel(perspective)}视角已就绪</span>
          </div>
          <p className="mt-1.5 mb-0 text-xs leading-relaxed text-white/52">
            开始后 Meetly 会进入顶部会话面板，持续监听当前会议，并按所选视角组织实时建议。
          </p>
        </section>

        <section className="mt-3 rounded-lg border border-dashed border-white/[0.12] bg-black/[0.12] p-3">
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2 text-sm font-semibold text-white/82">
              <UploadCloud className="h-4 w-4 shrink-0 text-white/65" />
              <span className="min-w-0 truncate">拖入{contextDocumentRoleLabel(perspective)}</span>
            </div>
            <button
              className="shrink-0 rounded-lg border border-white/15 bg-white/[0.06] px-2.5 py-1.5 text-xs text-white/78 transition-colors duration-150 hover:bg-white/[0.12]"
              onClick={openFilePicker}
            >
              选择文件
            </button>
          </div>
          <p className="mt-1.5 mb-0 text-xs leading-relaxed text-white/45">
            当前支持 {supportedContextDocumentLabel()}。资料会进入 Ask 和场边教练的上下文。
          </p>
          {contextDocumentMessage && (
            <p className="mt-2 mb-0 text-xs leading-relaxed text-white/50">{contextDocumentMessage}</p>
          )}
          {contextDocuments.length > 0 && (
            <ul className="mt-2 flex flex-col gap-1.5">
              {contextDocuments.map((document) => (
                <li key={document.id} className="flex items-center gap-2 rounded-md bg-white/[0.05] px-2 py-1.5 text-xs text-white/66">
                  <FileText className="h-3.5 w-3.5 shrink-0" />
                  <span className="min-w-0 flex-1 truncate">{document.name}</span>
                  <button className="text-white/38 hover:text-white/75" onClick={() => removeContextDocument(document.id)}>
                    移除
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <div className="flex shrink-0 items-center justify-between gap-2 border-t border-white/[0.08] bg-white/[0.035] px-4 py-3">
        <button className={GHOST_ICON_BUTTON} title="返回" onClick={closePanel}>
          <ArrowLeft />
        </button>
        <button
          className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-white/90 px-3 text-[13px] font-medium text-black transition-[background,transform] duration-150 hover:bg-white active:scale-[0.98] [&_svg]:h-4 [&_svg]:w-4"
          onClick={startMeeting}
        >
          <Mic />
          <span>以此视角开始</span>
        </button>
      </div>
    </section>
  );
}

function PerspectiveChoice({
  description,
  icon,
  isSelected,
  label,
  onSelect,
}: {
  description: string;
  icon: ReactNode;
  isSelected: boolean;
  label: string;
  onSelect: () => void;
}) {
  return (
    <button
      className={`min-h-[154px] rounded-lg border p-3 text-left transition-[background,border-color,transform] duration-150 active:scale-[0.99] ${
        isSelected
          ? "border-[#38d879]/45 bg-[#38d879]/12"
          : "border-white/[0.08] bg-white/[0.045] hover:bg-white/[0.075]"
      }`}
      onClick={onSelect}
    >
      <div className="flex items-start justify-between gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/[0.08] text-white/80 [&_svg]:h-4 [&_svg]:w-4">
          {icon}
        </span>
        {isSelected && (
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#38d879] text-black [&_svg]:h-3.5 [&_svg]:w-3.5">
            <Check />
          </span>
        )}
      </div>
      <h2 className="mt-4 mb-1 text-base font-semibold text-white">{label}</h2>
      <p className="m-0 text-xs leading-relaxed text-white/55">{description}</p>
    </button>
  );
}

function SettingsExpandedPanel({
  closePanel,
  startIslandDrag,
}: {
  closePanel: () => void;
  startIslandDrag: ReturnType<typeof useWindowActions>["startIslandDrag"];
}) {
  return (
    <section className={`flex h-full w-full flex-col overflow-hidden rounded-xl ${CARD_SURFACE}`}>
      <PanelHeader
        eyebrow="Workspace"
        title="设置"
        closePanel={closePanel}
        startIslandDrag={startIslandDrag}
      />
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        <SettingsContent compact onOnboardingCompleted={closePanel} onQuit={closePanel} />
      </div>
    </section>
  );
}

function PanelHeader({
  closePanel,
  eyebrow,
  startIslandDrag,
  title,
}: {
  closePanel: () => void;
  eyebrow: string;
  startIslandDrag: ReturnType<typeof useWindowActions>["startIslandDrag"];
  title: string;
}) {
  return (
    <div className="flex h-14 shrink-0 items-center justify-between border-b border-white/[0.08] bg-white/[0.04] px-3 py-2.5">
      <div className={`min-w-0 flex-1 ${DRAG_CURSOR}`} onMouseDown={startIslandDrag}>
        <p className="m-0 text-[11px] text-white/50">{eyebrow}</p>
        <h1 className="m-0 text-sm leading-tight">{title}</h1>
      </div>
      <button className={GHOST_ICON_BUTTON} title="收起" onClick={closePanel}>
        <ChevronDown />
      </button>
    </div>
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
      title="查看实时会话"
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

function IdleStatusLabel() {
  return (
    <div className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-lg px-1 text-left">
      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-white/35" />
      <span className="min-w-0 flex-1 truncate text-[13px] text-white/50">待机</span>
    </div>
  );
}

function AssistantPanel({
  closePanel,
  ctx,
  openFilePicker,
  startIslandDrag,
}: {
  closePanel: () => void;
  ctx: ReturnType<typeof useMeetlyState>;
  openFilePicker: () => void;
  startIslandDrag: ReturnType<typeof useWindowActions>["startIslandDrag"];
}) {
  return (
    <section className="absolute bottom-2 top-[62px] flex w-full flex-col overflow-hidden rounded-xl border border-white/10 bg-[rgb(27_27_28_/_0.82)] shadow-[0_10px_18px_rgb(0_0_0_/_0.22)] backdrop-blur-3xl">
      <div className="flex h-14 items-center justify-between border-b border-white/[0.08] bg-white/[0.04] px-3 py-2.5">
        <div className={`min-w-0 flex-1 ${DRAG_CURSOR}`} onMouseDown={startIslandDrag}>
          <p className="m-0 text-[11px] text-white/60">{ctx.state === "listening" ? "监听中" : "待机"}</p>
          <h1 className="m-0 text-sm leading-tight">面试会话</h1>
        </div>
        <button className={GHOST_ICON_BUTTON} title="上传资料" onClick={openFilePicker}>
          <UploadCloud />
        </button>
        <button className={GHOST_ICON_BUTTON} onClick={closePanel}>
          <ChevronDown className="rotate-180" />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden p-3.5">
        <AssistantPreview
          transcriptHistory={ctx.transcriptHistory}
          partialTranscript={ctx.partialTranscript}
          audioLevel={ctx.audioLevel}
          isListening={ctx.state === "listening"}
          transcriptError={ctx.transcriptError}
          assistantSuggestion={ctx.assistantSuggestion}
          assistantDraft={ctx.assistantDraft}
          assistantError={ctx.assistantError}
          isAsking={ctx.isAsking}
          coachMessages={ctx.coachMessages}
          contextDocuments={ctx.contextDocuments}
          coachDraft={ctx.coachDraft}
          coachActivity={ctx.coachActivity}
          isCoachThinking={ctx.isCoachThinking}
          autoAssistHint={ctx.autoAssistHint}
          prefetchStatus={ctx.prefetchStatus}
        />
      </div>
    </section>
  );
}

function getListeningStatusLabel({
  audioLevel,
  hasPartialTranscript,
  transcriptError,
}: {
  audioLevel: number;
  hasPartialTranscript: boolean;
  transcriptError: string | null;
}) {
  if (transcriptError) return "转写异常";
  if (hasPartialTranscript) return "转写中";
  if (audioLevel > 0.015) return "正在听";
  return "等待语音";
}

function getPerspectiveLabel(perspective: MeetingPerspective) {
  return perspective === "candidate" ? "面试者" : "面试官";
}
