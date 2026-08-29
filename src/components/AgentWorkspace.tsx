import {
  ArrowUp,
  Asterisk,
  Check,
  ChevronDown,
  AudioLines,
  CircleDot,
  FileClock,
  FileText,
  Globe2,
  Keyboard,
  ListTree,
  Maximize2,
  Mic,
  MicOff,
  Minus,
  PanelTopClose,
  Plus,
  Settings,
  TerminalSquare,
  TriangleAlert,
  X,
} from "lucide-react";
import { useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { AgentChatTurn, CoachMessage, CoachToolTrace, TranscriptSegment } from "../app/types";
import type { useMeetlyState } from "../app/useMeetlyState";
import { SettingsContent } from "../SettingsApp";
import { AudioBars } from "./AudioBars";

type WorkspaceView = "agent" | "fn" | "dictation" | "meetings" | "logs" | "settings";

type AgentWorkspaceProps = {
  askAssistant: (message?: string) => Promise<void>;
  clearConversation: () => void;
  closePanel: () => void;
  closeWorkspace: () => Promise<void>;
  ctx: ReturnType<typeof useMeetlyState>;
  initialView?: WorkspaceView;
  openFilePicker: () => void;
  startIslandDrag: (event: MouseEvent<HTMLElement>) => Promise<void>;
  toggleSession: () => void;
  toggleWorkspaceMaximized: () => Promise<void>;
};

const NAV_ITEMS: Array<{
  icon: typeof Asterisk;
  id: WorkspaceView;
  label: string;
  meta?: string;
}> = [
  { id: "agent", label: "Agent", icon: Asterisk },
  { id: "fn", label: "语音提问", icon: AudioLines, meta: "Fn" },
  { id: "dictation", label: "语音输入", icon: Keyboard, meta: "Fn + Space" },
  { id: "meetings", label: "会议记录", icon: FileClock },
  { id: "logs", label: "运行日志", icon: TerminalSquare },
  { id: "settings", label: "设置", icon: Settings },
];

export function AgentWorkspace({
  askAssistant,
  clearConversation,
  closePanel,
  closeWorkspace,
  ctx,
  initialView = "agent",
  openFilePicker,
  startIslandDrag,
  toggleSession,
  toggleWorkspaceMaximized,
}: AgentWorkspaceProps) {
  const [view, setView] = useState<WorkspaceView>(initialView);
  const [draft, setDraft] = useState("");
  const isMeetingActive = ctx.state === "listening";
  const activeView = isMeetingActive ? "agent" : view;

  const submit = () => {
    if (ctx.isAsking) return;
    const message = draft.trim() || "需要帮助";
    setDraft("");
    void askAssistant(message);
  };

  const handleInputKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter" || event.shiftKey) return;
    event.preventDefault();
    submit();
  };

  return (
    <section
      className={isMeetingActive ? "meetly-workspace is-meeting-active" : "meetly-workspace"}
      aria-label="Meetly workspace"
    >
      <header className="workspace-titlebar" onMouseDown={startIslandDrag}>
        <div className="workspace-window-controls" onMouseDown={(event) => event.stopPropagation()}>
          <button
            className="workspace-window-control is-close"
            title="关闭窗口"
            aria-label="关闭窗口"
            onClick={() => void closeWorkspace()}
          >
            <X />
          </button>
          <button
            className="workspace-window-control is-minimize"
            title="收起到横条"
            aria-label="收起到横条"
            onClick={closePanel}
          >
            <Minus />
          </button>
          <button
            className="workspace-window-control is-maximize"
            title="放大或还原工作台"
            aria-label="放大或还原工作台"
            onClick={() => void toggleWorkspaceMaximized()}
          >
            <Maximize2 />
          </button>
        </div>

        <div className="workspace-title">
          <h1>{NAV_ITEMS.find((item) => item.id === activeView)?.label}</h1>
          {activeView === "agent" && <span>{isMeetingActive ? "Listening" : "Ready"}</span>}
        </div>

        <div className="workspace-header-actions" onMouseDown={(event) => event.stopPropagation()}>
          {isMeetingActive && (
            <button
              className="workspace-header-button workspace-meeting-stop"
              title="结束会议"
              aria-label="结束会议"
              onClick={toggleSession}
            >
              <MicOff />
            </button>
          )}
          <button
            className="workspace-header-button workspace-collapse-action"
            title="收起为横条"
            aria-label="收起为横条"
            onClick={closePanel}
          >
            <PanelTopClose />
          </button>
          {!isMeetingActive && activeView === "agent" && (
            <>
              <button className="workspace-header-button" title="新对话" aria-label="新对话" onClick={clearConversation}>
                <Plus />
              </button>
              <button className="workspace-header-button" title="上传资料" aria-label="上传资料" onClick={openFilePicker}>
                <FileText />
              </button>
            </>
          )}
        </div>
      </header>

      <aside className="workspace-rail">
        <nav className="workspace-nav" aria-label="Workspace">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                className={activeView === item.id ? "workspace-nav-item is-active" : "workspace-nav-item"}
                aria-current={activeView === item.id ? "page" : undefined}
                title={item.meta ? `${item.label} · ${item.meta}` : item.label}
                onClick={() => setView(item.id)}
              >
                <Icon />
                <span>{item.label}</span>
                {item.meta && <kbd>{item.meta}</kbd>}
              </button>
            );
          })}
        </nav>

        <div className="workspace-rail-footer">
          <button
            className="workspace-session-button"
            title={ctx.state === "listening" ? "结束会话" : "开始会话"}
            aria-label={ctx.state === "listening" ? "结束会话" : "开始会话"}
            onClick={toggleSession}
          >
            {ctx.state === "listening" ? <MicOff /> : <Mic />}
            <span>{ctx.state === "listening" ? "结束会话" : "开始会话"}</span>
            <span className={ctx.state === "listening" ? "session-dot is-live" : "session-dot"} />
          </button>
        </div>
      </aside>

      <div className="workspace-stage">
        {activeView === "agent" ? (
          <div className="agent-layout">
            <div className="agent-column">
              <AgentTimeline
                chatTurns={ctx.agentChatTurns}
                coachDraft={ctx.coachDraft}
                coachMessages={ctx.coachMessages}
                isAsking={ctx.isAsking}
              />
              <div className="agent-composer-shell">
                <textarea
                  data-testid="agent-input"
                  autoFocus={initialView === "agent"}
                  rows={2}
                  value={draft}
                  placeholder="问会议里的任何事"
                  onChange={(event) => setDraft(event.target.value)}
                  onKeyDown={handleInputKeyDown}
                />
                <div className="agent-composer-footer">
                  <button
                    data-testid="agent-send"
                    title="发送"
                    aria-label="发送"
                    disabled={ctx.isAsking}
                    onClick={submit}
                  >
                    <ArrowUp />
                  </button>
                </div>
              </div>
            </div>
            <TranscriptRail ctx={ctx} />
          </div>
        ) : activeView === "settings" ? (
          <div className="workspace-settings">
            <SettingsContent
              compact
              onOnboardingCompleted={() => setView("agent")}
              onQuit={closePanel}
            />
          </div>
        ) : (
          <WorkspaceLedger view={activeView} ctx={ctx} />
        )}
      </div>
    </section>
  );
}

function AgentTimeline({
  chatTurns,
  coachDraft,
  coachMessages,
  isAsking,
}: {
  chatTurns: AgentChatTurn[];
  coachDraft: CoachMessage | null;
  coachMessages: CoachMessage[];
  isAsking: boolean;
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const entries = useMemo(() => [
    ...coachMessages.map((message) => ({ kind: "proactive" as const, createdAt: message.createdAt, message })),
    ...chatTurns.map((turn) => ({ kind: "chat" as const, createdAt: turn.createdAt, turn })),
  ].sort((left, right) => left.createdAt - right.createdAt), [chatTurns, coachMessages]);

  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [coachDraft?.text, coachDraft?.toolTraces, entries, isAsking]);

  return (
    <div ref={scrollRef} className="agent-timeline" data-testid="agent-timeline">
      {entries.length === 0 && !coachDraft && (
        <div className="agent-empty-state">
          <span className="agent-empty-glyph"><Asterisk /></span>
          <p>暂无对话</p>
          <span>Agent 会在这里保持同一条上下文。</span>
        </div>
      )}

      {entries.map((entry) => entry.kind === "proactive" ? (
        <AgentMessage
          key={`coach-${entry.message.id}`}
          label="主动"
          text={entry.message.text}
          time={entry.message.createdAt}
          toolTraces={entry.message.toolTraces}
        />
      ) : (
        <div key={entry.turn.id} className="agent-turn">
          <div className="agent-user-message">
            <span>{entry.turn.question}</span>
            <time>{formatTime(entry.turn.createdAt)}</time>
          </div>
          <AgentToolTraceList traces={entry.turn.toolTraces} />
          {entry.turn.error ? (
            <div className="agent-error-message">{entry.turn.error}</div>
          ) : entry.turn.suggestion ? (
            <AgentMessage
              label="回应"
              text={formatSuggestion(entry.turn.suggestion)}
              time={entry.turn.createdAt}
            />
          ) : (
            <div className="agent-thinking-row">
              <span /><span /><span />
              <p>正在处理这条请求</p>
            </div>
          )}
        </div>
      ))}

      {coachDraft && (
        <div className="agent-live-message">
          <div className="agent-message-meta">
            <span><CircleDot />主动</span>
            <span>生成中</span>
          </div>
          <AgentToolTraceList traces={coachDraft.toolTraces} />
          <div className="agent-markdown">
            {coachDraft.text || "正在判断当前时刻最有价值的下一步。"}
          </div>
        </div>
      )}
    </div>
  );
}

function AgentMessage({
  label,
  text,
  time,
  toolTraces = [],
}: {
  label: string;
  text: string;
  time: number;
  toolTraces?: CoachToolTrace[];
}) {
  return (
    <article className="agent-message">
      <div className="agent-message-meta">
        <span><Asterisk />{label}</span>
        <time>{formatTime(time)}</time>
      </div>
      <AgentToolTraceList traces={toolTraces} />
      <div className="agent-markdown">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
      </div>
    </article>
  );
}

function AgentToolTraceList({ traces }: { traces: CoachToolTrace[] }) {
  if (traces.length === 0) return null;

  return (
    <div className="agent-tool-list" aria-label="Agent tools">
      {traces.map((trace) => {
        const ToolIcon = trace.name === "read_file" ? FileText : Globe2;
        const StatusIcon = trace.status === "running"
          ? CircleDot
          : trace.status === "error"
            ? TriangleAlert
            : Check;
        return (
          <div key={trace.id} className={`agent-tool-row is-${trace.status}`}>
            <div className="agent-tool-summary">
              <ToolIcon />
              <div>
                <span>{trace.label}</span>
                {trace.query && <p>{trace.query}</p>}
              </div>
              <span className="agent-tool-status">
                <StatusIcon />
                {toolTraceStatus(trace)}
              </span>
            </div>
            {trace.content && (
              <details className="agent-tool-result">
                <summary>
                  <ChevronDown />
                  {trace.status === "error" ? "查看错误" : trace.name === "read_file" ? "查看内容" : "查看来源"}
                </summary>
                <ToolResultContent content={trace.content} isError={trace.status === "error"} />
              </details>
            )}
          </div>
        );
      })}
    </div>
  );
}

function ToolResultContent({ content, isError }: { content: string; isError: boolean }) {
  if (isError) return <p className="agent-tool-error">{content}</p>;
  const sources = content.split("\n\n").map((block) => {
    const [title, url] = block.split("\n");
    return { title, url };
  });

  return (
    <div className="agent-tool-sources">
      {sources.map((source, index) => source.url?.startsWith("http") ? (
        <a key={`${source.url}-${index}`} href={source.url} target="_blank" rel="noreferrer">
          <span>{source.title || source.url}</span>
          <small>{source.url}</small>
        </a>
      ) : (
        <p key={`${source.title}-${index}`}>{source.title}</p>
      ))}
    </div>
  );
}

function toolTraceStatus(trace: CoachToolTrace) {
  if (trace.status === "running") return trace.name === "read_file" ? "读取中" : "搜索中";
  if (trace.status === "error") return "失败";
  return "已完成";
}

function TranscriptRail({ ctx }: { ctx: ReturnType<typeof useMeetlyState> }) {
  const lines = ctx.transcriptHistory.slice(-7);
  const status = ctx.transcriptError
    ? "异常"
    : ctx.partialTranscript
      ? "转写中"
      : ctx.state === "listening"
        ? "正在听"
        : "已暂停";

  return (
    <aside className="transcript-rail">
      <div className="transcript-rail-header">
        <div>
          <p>实时转录</p>
          <span>{status}</span>
        </div>
        <AudioBars level={ctx.audioLevel} tone="cool" variant="compact" />
      </div>
      <div className="transcript-lines">
        {lines.length === 0 && !ctx.partialTranscript ? (
          <p className="transcript-empty">暂无转录</p>
        ) : (
          lines.map((segment) => <TranscriptLine key={segment.id} segment={segment} />)
        )}
        {ctx.partialTranscript && (
          <div className="transcript-line is-live">
            <span>现在</span>
            <p>{ctx.partialTranscript.text}</p>
          </div>
        )}
      </div>
      <div className="transcript-rail-footer">
        <ListTree />
        <span>{ctx.transcriptHistory.length} 条记录</span>
      </div>
    </aside>
  );
}

function TranscriptLine({ segment }: { segment: TranscriptSegment }) {
  return (
    <div className="transcript-line">
      <span>{segment.speaker === "user" ? "我" : "对方"}</span>
      <p>{segment.text}</p>
    </div>
  );
}

type LedgerContent = {
  kicker: string;
  emptyTitle: string;
  emptyDescription: string;
  rows: Array<{
    time: string;
    title: string;
    body: string;
    status: string;
    tone?: "live";
  }>;
};

function WorkspaceLedger({ view, ctx }: { view: Exclude<WorkspaceView, "agent">; ctx: ReturnType<typeof useMeetlyState> }) {
  const content = getLedgerContent(view, ctx);
  return (
    <div className="workspace-ledger">
      <div className="ledger-list">
        {content.rows.length === 0 ? (
          <div className="ledger-empty-state">
            <span>{content.kicker}</span>
            <h2>{content.emptyTitle}</h2>
            <p>{content.emptyDescription}</p>
          </div>
        ) : (
          content.rows.map((row, index) => (
            <article key={`${view}-${index}`} className="ledger-row">
              <time>{row.time}</time>
              <div>
                <h2>{row.title}</h2>
                <p>{row.body}</p>
              </div>
              <span className={row.tone === "live" ? "ledger-status is-live" : "ledger-status"}>{row.status}</span>
            </article>
          ))
        )}
      </div>
    </div>
  );
}

function getLedgerContent(
  view: Exclude<WorkspaceView, "agent">,
  ctx: ReturnType<typeof useMeetlyState>
): LedgerContent {
  if (view === "fn") {
    return {
      kicker: "VOICE ASK",
      emptyTitle: "暂无语音提问",
      emptyDescription: "当前没有可显示的语音提问记录。",
      rows: [],
    };
  }
  if (view === "dictation") {
    return {
      kicker: "DICTATION",
      emptyTitle: "暂无语音输入记录",
      emptyDescription: "当前没有可显示的语音输入记录。",
      rows: [],
    };
  }
  if (view === "meetings") {
    const session = ctx.interviewSession;
    return {
      kicker: "MEETINGS",
      emptyTitle: "暂无会议记录",
      emptyDescription: "开始一次会话后，当前会议会显示在这里。",
      rows: session ? [
        {
          time: formatTime(session.startedAt),
          title: session.goal || "未命名会议",
          body: `${session.transcript.length} 条转录 · ${ctx.coachMessages.length + ctx.agentChatTurns.length} 条 Agent 记录`,
          status: session.status === "listening" ? "进行中" : session.status === "error" ? "异常结束" : "已结束",
          tone: session.status === "listening" ? "live" : undefined,
        },
      ] : [],
    };
  }
  return {
    kicker: "RUNTIME",
    emptyTitle: "暂无运行日志",
    emptyDescription: "当前没有可显示的运行日志。",
    rows: ctx.transcriptError ? [
      {
        time: "当前",
        title: "转录异常",
        body: ctx.transcriptError,
        status: "异常",
      },
    ] : [],
  };
}

function formatSuggestion(suggestion: AgentChatTurn["suggestion"] & {}) {
  if (!suggestion) return "";
  return [
    suggestion.answer,
    suggestion.bullets.length ? suggestion.bullets.map((bullet) => `- ${bullet}`).join("\n") : null,
    suggestion.clarifyingQuestion ? `> ${suggestion.clarifyingQuestion}` : null,
  ].filter(Boolean).join("\n\n");
}

function formatTime(timestamp: number) {
  return new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false }).format(timestamp);
}
