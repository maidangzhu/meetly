import {
  AlertCircle,
  AudioLines,
  Camera,
  ChevronDown,
  GripVertical,
  Headphones,
  Loader2,
  Sparkles,
} from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { useCallback, useMemo, useState } from "react";

type IslandState = "idle" | "listening" | "transcribing" | "thinking" | "error";
type OpenPanel = null | "assistant" | "audio" | "diagnostics";

const isTauriRuntime = () => "__TAURI_INTERNALS__" in window;

async function safeInvoke<T>(command: string, args?: Record<string, unknown>) {
  if (!isTauriRuntime()) {
    return undefined as T;
  }

  return invoke<T>(command, args);
}

export function App() {
  const [state, setState] = useState<IslandState>("idle");
  const [openPanel, setOpenPanel] = useState<OpenPanel>(null);
  const [isHidden, setIsHidden] = useState(false);

  const isExpanded = openPanel !== null;

  const resizeIsland = useCallback(async (expanded: boolean) => {
    await safeInvoke("set_island_height", { height: expanded ? 600 : 54 });
  }, []);

  const setPanel = useCallback(
    async (panel: OpenPanel) => {
      setOpenPanel(panel);
      await resizeIsland(panel !== null);
    },
    [resizeIsland]
  );

  const toggleListening = useCallback(() => {
    setState((current) => (current === "listening" ? "idle" : "listening"));
  }, []);

  const toggleHidden = useCallback(async () => {
    setIsHidden((current) => !current);
    await safeInvoke("set_island_visible", { visible: isHidden });
  }, [isHidden]);

  const status = useMemo(() => {
    if (state === "error") {
      return {
        icon: <AlertCircle className="icon danger" />,
        label: "Setup needed",
        className: "status danger",
      };
    }

    if (state === "thinking") {
      return {
        icon: <Loader2 className="icon spin" />,
        label: "Generating...",
        className: "status muted",
      };
    }

    if (state === "transcribing") {
      return {
        icon: <Loader2 className="icon spin" />,
        label: "Transcribing...",
        className: "status muted",
      };
    }

    if (state === "listening") {
      return {
        icon: <span className="pulse-dot" />,
        label: "Listening...",
        className: "status success",
      };
    }

    return {
      icon: null,
      label: "Ready",
      className: "status",
    };
  }, [state]);

  if (isHidden) {
    return (
      <div className="island-host hidden-host">
        <button className="restore-button" onClick={toggleHidden}>
          Show
        </button>
      </div>
    );
  }

  return (
    <main className="island-host">
      <section className="island-card" aria-label="Meeting assistant island">
        <button
          className={`icon-button ${state === "listening" ? "success-bg" : ""}`}
          title={state === "listening" ? "Stop listening" : "Start listening"}
          onClick={toggleListening}
        >
          {state === "listening" ? <AudioLines /> : <Headphones />}
        </button>

        <span className="drag-spacer" data-tauri-drag-region="true" />

        <div
          className={`center-lane ${state === "listening" ? "drag-lane" : ""}`}
          data-tauri-drag-region={state === "listening" ? "true" : undefined}
        >
          {state === "listening" ? (
            <>
              <AudioBars />
              <p className="ticker" data-tauri-drag-region="true">
                正在等待会议音频，实时转写会显示在这里
              </p>
            </>
          ) : (
            <button
              className="ask-input"
              onClick={() => setPanel(isExpanded ? null : "assistant")}
              title="Open assistant panel"
            >
              <Sparkles className="ask-icon" />
              <span>Ask...</span>
              <ChevronDown className={`chevron ${isExpanded ? "open" : ""}`} />
            </button>
          )}
        </div>

        <button
          className="icon-button"
          title="Capture screenshot"
          onClick={() => setPanel("assistant")}
        >
          <Camera />
        </button>

        <span className="drag-spacer" data-tauri-drag-region="true" />

        <button
          className="icon-button ghost"
          title="Open diagnostics"
          onClick={() => setPanel(openPanel === "diagnostics" ? null : "diagnostics")}
        >
          {status.icon}
          {!status.icon && <span className="idle-dot" />}
        </button>

        <div className={status.className} data-tauri-drag-region="true">
          {status.icon}
          <span>{status.label}</span>
        </div>

        <button
          className="drag-handle"
          title="Drag island"
          data-tauri-drag-region="true"
        >
          <GripVertical />
        </button>
      </section>

      {openPanel && (
        <section className="island-panel">
          <div className="panel-header">
            <div className="panel-title-drag" data-tauri-drag-region="true">
              <p className="eyebrow">MVP 0.1</p>
              <h1>{openPanel === "diagnostics" ? "Diagnostics" : "Assistant"}</h1>
            </div>
            <button className="icon-button ghost" onClick={() => setPanel(null)}>
              <ChevronDown className="chevron open" />
            </button>
          </div>

          <div className="panel-body">
            {openPanel === "diagnostics" ? (
              <Diagnostics />
            ) : (
              <AssistantPreview state={state} setState={setState} />
            )}
          </div>
        </section>
      )}
    </main>
  );
}

function AudioBars() {
  return (
    <div className="audio-bars" aria-hidden="true">
      {Array.from({ length: 18 }).map((_, index) => (
        <span key={index} style={{ animationDelay: `${index * 55}ms` }} />
      ))}
    </div>
  );
}

function AssistantPreview({
  state,
  setState,
}: {
  state: IslandState;
  setState: (state: IslandState) => void;
}) {
  return (
    <>
      <div className="preview-block">
        <p className="label">当前阶段</p>
        <p>
          这是 0.1 的空灵动岛骨架。音频、STT、LLM、BYOK 会在后续小版本按
          OpenSpec change 逐步接入。
        </p>
      </div>
      <div className="button-row">
        <button className="secondary-button" onClick={() => setState("idle")}>
          Idle
        </button>
        <button className="secondary-button" onClick={() => setState("listening")}>
          Listening
        </button>
        <button className="secondary-button" onClick={() => setState("thinking")}>
          Thinking
        </button>
        <button className="secondary-button" onClick={() => setState("error")}>
          Error
        </button>
      </div>
      <div className="answer-card">
        <p className="label">Pluely-style 验收</p>
        <ul>
          <li>顶部居中 600 x 54 收起态。</li>
          <li>横向 Card、图标按钮、拖拽手柄。</li>
          <li>展开后保持 600px 宽度，面板从下方出现。</li>
        </ul>
      </div>
      <p className="footnote">Current state: {state}</p>
    </>
  );
}

function Diagnostics() {
  return (
    <div className="diagnostics-grid">
      <DiagnosticItem label="Tauri shell" value="Ready" state="ok" />
      <DiagnosticItem label="Island window" value="600 x 54" state="ok" />
      <DiagnosticItem label="Native audio" value="Not implemented" state="pending" />
      <DiagnosticItem label="Stealth guard" value="Not implemented" state="pending" />
      <DiagnosticItem label="BYOK storage" value="Not implemented" state="pending" />
    </div>
  );
}

function DiagnosticItem({
  label,
  value,
  state,
}: {
  label: string;
  value: string;
  state: "ok" | "pending";
}) {
  return (
    <div className="diagnostic-item">
      <span className={`diagnostic-dot ${state}`} />
      <div>
        <p>{label}</p>
        <span>{value}</span>
      </div>
    </div>
  );
}
