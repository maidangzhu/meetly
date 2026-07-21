import {
  ArrowLeft,
  ChevronDown,
  Check,
  Eye,
  EyeOff,
  FileText,
  GripVertical,
  Handshake,
  Mic,
  MicOff,
  MonitorUp,
  PanelTopOpen,
  Settings as SettingsIcon,
  UploadCloud,
  X,
} from "lucide-react";
import { useEffect, useRef, useState, type ChangeEvent, type DragEvent, type ReactNode } from "react";
import {
  CARD_SURFACE,
  DRAG_CURSOR,
  GHOST_ICON_BUTTON,
} from "./app/constants";
import { readDroppedContextFiles, supportedContextDocumentLabel } from "./app/contextDocuments";
import { safeInvoke } from "./app/platform";
import { resolveAudioSourceForSessionChange } from "./app/sessionAudio";
import type { AudioSource, MeetingPerspective, SessionKind } from "./app/types";
import { useAgentRuntime } from "./app/useAgentRuntime";
import { useAssistantAsk } from "./app/useAssistantAsk";
import { useAutoAssist } from "./app/useAutoAssist";
import { useMeetlyState } from "./app/useMeetlyState";
import { useMicMeeting } from "./app/useMicMeeting";
import { useSessionActions } from "./app/useSessionActions";
import { useTauriEvents } from "./app/useTauriEvents";
import { useWindowActions } from "./app/useWindowActions";
import { AgentWorkspace } from "./components/AgentWorkspace";
import { AudioBars } from "./components/AudioBars";
import type { OnboardingStatus } from "./settings/OnboardingPanel";

export function App() {
  const ctx = useMeetlyState();
  const session = useSessionActions(ctx);
  const windowActions = useWindowActions(ctx);
  const agent = useAgentRuntime(ctx);
  const autoAssist = useAutoAssist(ctx, session, agent);
  const mic = useMicMeeting(ctx, agent, autoAssist, session, windowActions);
  const assistant = useAssistantAsk(ctx, session, windowActions, mic.flushCurrentMicSegment, agent);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [isDraggingFile, setIsDraggingFile] = useState(false);
  const panelPreview = import.meta.env.DEV
    ? new URLSearchParams(window.location.search).get("panel")
    : null;

  useTauriEvents(ctx, autoAssist, session, agent);

  useEffect(() => {
    if (!panelPreview) return;

    if (panelPreview === "assistant") {
      const now = Date.now();
      ctx.setState("listening");
      ctx.setAudioLevel(0.42);
      ctx.setOpenPanel("assistant");
      ctx.setContextDocuments([
        {
          id: "preview-document",
          name: "产品背景.md",
          kind: "reference",
          text: "Preview context",
          size: 1280,
          createdAt: now,
        },
      ]);
      ctx.setAssistantSuggestion({
        answer: "先确认对方真正关心的约束，再用一个具体案例说明你的判断过程。",
        bullets: ["先给结论", "补充判断依据", "最后说明结果"],
        clarifyingQuestion: null,
      });
      ctx.setTranscriptHistory([
        {
          id: "preview-transcript-1",
          source: "system",
          speaker: "interviewer",
          text: "你会怎么判断一个功能现在是否值得做？",
          startMs: 0,
          endMs: 3200,
        },
        {
          id: "preview-transcript-2",
          source: "microphone",
          speaker: "user",
          text: "我会先看用户问题是否高频，再判断解决方案能不能形成稳定闭环。",
          startMs: 3400,
          endMs: 7600,
        },
      ]);
      ctx.setPartialTranscript({
        text: "如果信号还不够，我会先做更小的验证...",
        startMs: 7800,
        endMs: 9600,
      });
      ctx.setCoachMessages([
        {
          id: "preview-coach-1",
          createdAt: now,
          trigger: "question_detected",
          text: "可以补一句你会用什么指标判断验证成功。",
          contextPreview: "Preview coach context",
          toolTraces: [],
        },
      ]);
      const previewTurns = [
        {
          id: "preview-chat-1",
          createdAt: now + 1,
          question: "这段讨论里，最需要追问的是什么？",
          suggestion: {
            answer: "最需要确认的是验证成功的判断标准。现在只有方向，没有明确的观察窗口、负责人和退出条件。",
            bullets: ["确认两周内看哪个指标", "指定唯一负责人", "提前约定无效时如何收缩范围"],
            clarifyingQuestion: null,
          },
          error: null,
          toolTraces: [
            {
              id: "preview-read-file-1",
              name: "read_file",
              label: "读取资料",
              status: "completed" as const,
              query: "产品背景.md",
              content: "产品背景.md\n\n这份资料记录了产品目标、当前约束和本轮会议需要确认的决策。",
              createdAt: now + 2,
              completedAt: now + 3,
            },
          ],
        },
      ];
      ctx.agentChatTurnsRef.current = previewTurns;
      ctx.setAgentChatTurns(previewTurns);
      void windowActions.resizeIsland(true);
      return;
    }

    if (panelPreview === "settings" || panelPreview === "perspective") {
      ctx.setOpenPanel(panelPreview);
      void windowActions.resizeIsland(true);
    }
  }, []);

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

  return (
    <main
      className="flex h-screen w-screen items-start justify-center overflow-hidden bg-transparent"
      style={panelPreview ? { width: 940, height: 620 } : undefined}
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
        <div
          className="relative h-full w-full"
          onDragEnter={handleDragOver}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={(event) => void handleDroppedFiles(event)}
        >
          {isDraggingFile && (
            <div
              className="context-drop-overlay pointer-events-none absolute inset-0 z-50 flex items-center justify-center rounded-lg border backdrop-blur-sm"
              aria-hidden="true"
            >
              <div className="flex items-center gap-2 px-3 py-2 text-sm font-medium">
                <UploadCloud className="h-4 w-4" />
                <span>松开上传资料</span>
              </div>
            </div>
          )}

          {ctx.openPanel === "assistant" || ctx.openPanel === "settings" ? (
            <AgentWorkspace
              askAssistant={assistant.askAssistant}
              clearConversation={assistant.clearConversation}
              closePanel={() => void windowActions.setPanel(null)}
              closeWorkspace={windowActions.closeWorkspace}
              ctx={ctx}
              initialView={ctx.openPanel === "settings" ? "settings" : "agent"}
              openFilePicker={openFilePicker}
              startIslandDrag={windowActions.startIslandDrag}
              toggleSession={toggleSession}
              toggleWorkspaceMaximized={windowActions.toggleWorkspaceMaximized}
            />
          ) : ctx.openPanel === "perspective" ? (
            <PerspectivePanel
              backToWorkspace={() => void windowActions.setPanel("assistant")}
              collapseToBar={() => void windowActions.setPanel(null)}
              meetingGoal={ctx.meetingGoal}
              sessionKind={ctx.sessionKind}
              contextDocumentMessage={ctx.contextDocumentMessage}
              contextDocuments={ctx.contextDocuments}
              openFilePicker={openFilePicker}
              removeContextDocument={session.removeContextDocument}
              setMeetingGoal={ctx.setMeetingGoal}
              setSessionKind={(kind) => {
                ctx.setSessionKind(kind);
                ctx.setAudioSource(resolveAudioSourceForSessionChange(kind, ctx.audioSource));
                ctx.setAssistantMode("meeting");
              }}
              startIslandDrag={windowActions.startIslandDrag}
              startMeeting={() => void mic.startMicMeeting()}
            />
          ) : (
            <IslandBar
              ctx={ctx}
              setPanel={windowActions.setPanel}
              startIslandDrag={windowActions.startIslandDrag}
              toggleSession={toggleSession}
              toggleStealth={windowActions.toggleStealth}
            />
          )}
        </div>
      </div>
    </main>
  );
}

function IslandBar({
  ctx,
  setPanel,
  startIslandDrag,
  toggleSession,
  toggleStealth,
}: {
  ctx: ReturnType<typeof useMeetlyState>;
  setPanel: ReturnType<typeof useWindowActions>["setPanel"];
  startIslandDrag: ReturnType<typeof useWindowActions>["startIslandDrag"];
  toggleSession: () => void;
  toggleStealth: () => Promise<void>;
}) {
  const isListening = ctx.state === "listening";

  return (
    <section
      className={`meetly-island flex h-12 min-w-0 select-none items-center gap-1.5 rounded-lg p-1.5 ${CARD_SURFACE} ${
        isListening ? "w-full" : "mx-auto w-fit"
      }`}
      aria-label="Meetly assistant island"
    >
      <button
        className={`voice-launch-button ${isListening ? "voice-launch-button--active" : ""}`}
        title={isListening ? "结束当前会话" : "开始一次会话"}
        aria-label={isListening ? "结束当前会话" : "开始一次会话"}
        onClick={toggleSession}
      >
        {isListening ? <MicOff /> : <Mic />}
      </button>

      {isListening ? (
        <div className="flex h-9 min-w-0 flex-1 items-center gap-2">
          <AudioBars level={ctx.audioLevel} tone="cool" />
          <ListeningStatusButton
            audioLevel={ctx.audioLevel}
            latestText={ctx.partialTranscript?.text ?? ctx.latestTranscript?.text ?? null}
            source={ctx.audioSource}
            setPanel={setPanel}
            statusLabel={getListeningStatusLabel({
              audioLevel: ctx.audioLevel,
              hasPartialTranscript: Boolean(ctx.partialTranscript),
              transcriptError: ctx.transcriptError,
            })}
            transcriptError={ctx.transcriptError}
          />
        </div>
      ) : (
        <button
          className="voice-toolbar-button"
          title="打开工作台"
          aria-label="打开工作台"
          onClick={() => void setPanel("assistant")}
        >
          <PanelTopOpen />
        </button>
      )}

      <button
        className={`voice-toolbar-button ${ctx.isStealthOn ? "voice-toolbar-button--active" : ""}`}
        title={ctx.isStealthOn ? "Undetectable：点击切换为 Detectable" : "Detectable：点击切换为 Undetectable"}
        aria-label={ctx.isStealthOn ? "Undetectable" : "Detectable"}
        aria-pressed={ctx.isStealthOn}
        onClick={toggleStealth}
      >
        {ctx.isStealthOn ? <EyeOff /> : <Eye />}
      </button>

      <button className="voice-toolbar-button" title="设置" onClick={() => void setPanel("settings")}>
        <SettingsIcon />
      </button>

      <div
        className={`voice-toolbar-button ${DRAG_CURSOR}`}
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
  backToWorkspace,
  collapseToBar,
  contextDocumentMessage,
  contextDocuments,
  meetingGoal,
  openFilePicker,
  removeContextDocument,
  sessionKind,
  setMeetingGoal,
  setSessionKind,
  startIslandDrag,
  startMeeting,
}: {
  backToWorkspace: () => void;
  collapseToBar: () => void;
  contextDocumentMessage: string | null;
  contextDocuments: ReturnType<typeof useMeetlyState>["contextDocuments"];
  meetingGoal: string;
  openFilePicker: () => void;
  removeContextDocument: (id: string) => void;
  sessionKind: SessionKind;
  setMeetingGoal: (goal: string) => void;
  setSessionKind: (kind: SessionKind) => void;
  startIslandDrag: ReturnType<typeof useWindowActions>["startIslandDrag"];
  startMeeting: () => void;
}) {
  return (
    <section className="session-setup-panel app-panel flex h-full w-full flex-col overflow-hidden">
      <PanelHeader
        eyebrow="MEETING"
        title="新会议"
        closePanel={collapseToBar}
        startIslandDrag={startIslandDrag}
      />

      <div className="session-setup-body grid min-h-0 flex-1 grid-cols-[minmax(0,1.08fr)_minmax(300px,0.92fr)] overflow-hidden">
        <div className="session-setup-column min-h-0 overflow-y-auto border-r border-white/[0.08] px-6 py-5">
          <p className="section-label">会话类型</p>
          <div className="session-setup-switcher mt-2 grid grid-cols-2">
            <SetupSegment
              icon={<MonitorUp />}
              isSelected={sessionKind === "remote"}
              label="远程会议"
              onSelect={() => setSessionKind("remote")}
            />
            <SetupSegment
              icon={<Handshake />}
              isSelected={sessionKind === "in_person"}
              label="现场会议"
              onSelect={() => setSessionKind("in_person")}
            />
          </div>

          <label className="mt-5 block">
            <span className="section-label mb-2 block">本次目标</span>
            <textarea
              className="ui-field min-h-[110px] resize-none leading-relaxed"
              placeholder="例如：确认合作范围、启动时间和双方负责人"
              value={meetingGoal}
              onChange={(event) => setMeetingGoal(event.target.value)}
            />
          </label>
        </div>

        <div className="session-setup-column min-h-0 overflow-y-auto px-6 py-5">
          <p className="section-label">声音采集</p>
          <div className="session-audio-summary mt-2 border-y border-white/[0.09] py-3.5">
            <div className="flex items-center gap-2 text-sm text-white/76">
              {sessionKind === "remote" ? <MonitorUp className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
              <span>{sessionKind === "remote" ? "对方声音 + 你的声音" : "现场声音"}</span>
            </div>
            <p className="mt-1.5 mb-0 text-xs leading-relaxed text-white/42">
              {sessionKind === "remote"
                ? "同时监听系统音频和本机麦克风，按时间合并对话。"
                : "使用本机麦克风监听同一空间里的对话。"}
            </p>
          </div>

          <section className="session-context-section mt-5 border-t border-white/[0.08] pt-4">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="section-label">上下文资料</p>
                <p className="mt-1 mb-0 text-[11px] text-white/36">
                  {supportedContextDocumentLabel()} · 最多保留 6 份
                </p>
              </div>
              <button className="ui-secondary-button shrink-0" onClick={openFilePicker}>
                <UploadCloud className="h-3.5 w-3.5" />
                选择文件
              </button>
            </div>
            <p className="mt-3 mb-0 text-xs leading-relaxed text-white/46">
              可拖入会议资料，用于 Agent 对话和主动建议。
            </p>
            {contextDocumentMessage && (
              <p className="mt-2 mb-0 text-xs leading-relaxed text-white/52">{contextDocumentMessage}</p>
            )}
            {contextDocuments.length > 0 && (
              <ul className="mt-3 border-t border-white/[0.07]">
                {contextDocuments.map((document) => (
                  <li key={document.id} className="flex h-9 items-center gap-2 border-b border-white/[0.07] text-xs text-white/64">
                    <FileText className="h-3.5 w-3.5 shrink-0 text-[#b9c6cc]" />
                    <span className="min-w-0 flex-1 truncate">{document.name}</span>
                    <button className="text-white/34 hover:text-white/72" onClick={() => removeContextDocument(document.id)}>
                      移除
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>

      <div className="session-setup-footer flex shrink-0 items-center justify-between gap-2 border-t border-white/[0.08] px-4 py-3">
        <button
          className={GHOST_ICON_BUTTON}
          title="返回工作台"
          aria-label="返回工作台"
          onClick={backToWorkspace}
        >
          <ArrowLeft />
        </button>
        <button
          className="ui-primary-button [&_svg]:h-4 [&_svg]:w-4"
          onClick={startMeeting}
        >
          {sessionKind === "remote" ? <MonitorUp /> : <Handshake />}
          <span>开始{sessionKind === "remote" ? "远程会议" : "现场会议"}</span>
        </button>
      </div>
    </section>
  );
}

function SetupSegment({
  icon,
  isSelected,
  label,
  onSelect,
}: {
  icon: ReactNode;
  isSelected: boolean;
  label: string;
  onSelect: () => void;
}) {
  return (
    <button
      className={`session-setup-option inline-flex h-11 items-center justify-center gap-2 text-sm font-medium transition-colors [&_svg]:h-4 [&_svg]:w-4 ${isSelected ? "is-selected" : ""}`}
      aria-pressed={isSelected}
      onClick={onSelect}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

function AudioSourceChoice({
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
      className={`flex min-h-[64px] items-center gap-2.5 rounded-md border px-3 text-left transition-colors ${
        isSelected
          ? "border-[#c17f59]/55 bg-[#c17f59]/10"
          : "border-white/[0.08] bg-white/[0.02] hover:bg-white/[0.05]"
      }`}
      aria-pressed={isSelected}
      onClick={onSelect}
    >
      <span className={`shrink-0 [&_svg]:h-4 [&_svg]:w-4 ${isSelected ? "text-[#d0a083]" : "text-white/42"}`}>
        {icon}
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-medium text-white/86">{label}</span>
        <span className="mt-0.5 block text-[11px] text-white/42">{description}</span>
      </span>
    </button>
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
      className={`flex min-h-[74px] items-center gap-3 rounded-md border px-3 text-left transition-[background,border-color,transform] duration-150 active:scale-[0.99] ${
        isSelected
          ? "border-[#c17f59]/55 bg-[#c17f59]/10"
          : "border-white/[0.08] bg-white/[0.02] hover:bg-white/[0.05]"
      }`}
      onClick={onSelect}
    >
      <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-md [&_svg]:h-4 [&_svg]:w-4 ${
        isSelected ? "bg-[#c17f59]/16 text-[#d0a083]" : "bg-white/[0.05] text-white/48"
      }`}>
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-white/86">{label}</span>
        <span className="mt-0.5 block text-xs leading-relaxed text-white/46">{description}</span>
      </span>
      {isSelected && <Check className="h-4 w-4 shrink-0 text-[#d0a083]" />}
    </button>
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
    <div className="app-panel-header flex h-[52px] shrink-0 items-center justify-between px-3.5 py-2">
      <div className={`min-w-0 flex-1 ${DRAG_CURSOR}`} onMouseDown={startIslandDrag}>
        <p className="m-0 text-[10px] text-white/34">{eyebrow}</p>
        <h1 className="m-0 text-[13px] font-semibold leading-tight text-white/88">{title}</h1>
      </div>
      <button className={GHOST_ICON_BUTTON} title="收起" onClick={closePanel}>
        <ChevronDown />
      </button>
    </div>
  );
}

function ListeningStatusButton({
  audioLevel,
  latestText,
  source,
  setPanel,
  statusLabel,
  transcriptError,
}: {
  audioLevel: number;
  latestText: string | null;
  source: AudioSource;
  setPanel: (panel: "assistant") => Promise<void>;
  statusLabel: string;
  transcriptError: string | null;
}) {
  return (
    <button
      className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-md bg-transparent px-1 text-left transition-colors duration-150 hover:bg-white/[0.045]"
      title="查看实时会话"
      onClick={() => setPanel("assistant")}
    >
      <span className="shrink-0 border-l-2 border-[#9cafb8] pl-2 text-[11px] font-medium text-[#b9c6cc]">
        {statusLabel}
      </span>
      <p className="m-0 min-w-0 flex-1 truncate text-[13px] text-white/70">
        {transcriptError
          ? `转写失败：${transcriptError}`
          : latestText ?? (audioLevel > 0.015
            ? source === "microphone" ? "正在听身边的对话" : "正在听电脑会议"
            : source === "microphone" ? "等待现场声音" : "等待电脑播放声音")}
      </p>
    </button>
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
