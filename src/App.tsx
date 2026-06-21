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
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useCallback, useMemo, useState, type MouseEvent } from "react";

type IslandState = "idle" | "listening" | "transcribing" | "thinking" | "error";
type OpenPanel = null | "assistant" | "audio" | "diagnostics";

const CARD_SURFACE =
  "border border-white/10 bg-[rgb(27_27_28_/_0.82)] shadow-[0_8px_24px_rgb(0_0_0_/_0.16)] backdrop-blur-[20px]";
const ICON_BUTTON =
  "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border-0 bg-white/[0.08] text-[#f5f5f5] transition-[background,color,transform] duration-150 hover:bg-white/[0.14] active:scale-[0.98] [&_svg]:h-4 [&_svg]:w-4";
const GHOST_ICON_BUTTON =
  "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border-0 bg-transparent text-white/60 transition-[background,color,transform] duration-150 hover:bg-white/[0.14] active:scale-[0.98] [&_svg]:h-4 [&_svg]:w-4";
const DRAG_CURSOR = "cursor-grab active:cursor-grabbing";

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

  const startIslandDrag = useCallback(async (event: MouseEvent<HTMLElement>) => {
    if (event.button !== 0 || !isTauriRuntime()) {
      return;
    }

    event.preventDefault();

    try {
      await getCurrentWindow().startDragging();
    } catch (error) {
      console.error("Failed to start island drag:", error);
    }
  }, []);

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
        icon: <AlertCircle className="h-3.5 w-3.5 text-[#ff5c70]" />,
        label: "Setup needed",
        className: "text-[#ff5c70]",
      };
    }

    if (state === "thinking") {
      return {
        icon: <Loader2 className="h-3.5 w-3.5 animate-spin" />,
        label: "Generating...",
        className: "text-white/70",
      };
    }

    if (state === "transcribing") {
      return {
        icon: <Loader2 className="h-3.5 w-3.5 animate-spin" />,
        label: "Transcribing...",
        className: "text-white/70",
      };
    }

    if (state === "listening") {
      return {
        icon: (
          <span className="inline-block h-2 w-2 shrink-0 rounded-full bg-[#38d879] shadow-[0_0_0_0_rgb(56_216_121_/_0.42)] [animation:listening-dot-pulse_1.4s_infinite]" />
        ),
        label: "Listening...",
        className: "text-[#38d879]",
      };
    }

    return {
      icon: null,
      label: "Ready",
      className: "text-white/60",
    };
  }, [state]);

  if (isHidden) {
    return (
      <div className="flex h-screen w-screen items-start justify-center overflow-hidden bg-transparent pointer-events-none">
        <button
          className="pointer-events-auto mt-2 rounded-xl border border-white/10 bg-[rgb(27_27_28_/_0.82)] px-3 py-2 text-white"
          onClick={toggleHidden}
        >
          Show
        </button>
      </div>
    );
  }

  return (
    <main className="flex h-screen w-screen items-start justify-center overflow-hidden bg-transparent">
      <section
        className={`flex h-[54px] w-full min-w-0 select-none items-center gap-2 rounded-xl p-2 ${CARD_SURFACE}`}
        aria-label="Meeting assistant island"
      >
        <button
          className={`${ICON_BUTTON} ${
            state === "listening" ? "bg-[#38d879]/20 text-[#38d879]" : ""
          }`}
          title={state === "listening" ? "Stop listening" : "Start listening"}
          onClick={toggleListening}
        >
          {state === "listening" ? <AudioLines /> : <Headphones />}
        </button>

        <span
          className={`h-full w-1.5 shrink-0 self-stretch ${DRAG_CURSOR}`}
          onMouseDown={startIslandDrag}
        />

        <div
          className={`flex h-[38px] min-w-0 flex-1 items-center gap-2.5 ${
            state === "listening" ? DRAG_CURSOR : ""
          }`}
          onMouseDown={state === "listening" ? startIslandDrag : undefined}
        >
          {state === "listening" ? (
            <>
              <AudioBars />
              <p className="m-0 min-w-0 flex-1 truncate text-[13px] text-white/70">
                正在等待会议音频，实时转写会显示在这里
              </p>
            </>
          ) : (
            <button
              className="flex h-9 w-full min-w-0 items-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.06] px-2.5 text-left text-white/80"
              onClick={() => setPanel(isExpanded ? null : "assistant")}
              title="Open assistant panel"
            >
              <Sparkles className="h-[15px] w-[15px] shrink-0" />
              <span className="min-w-0 flex-1 truncate">Ask...</span>
              <ChevronDown
                className={`h-[15px] w-[15px] shrink-0 text-white/60 transition-transform duration-150 ${
                  isExpanded ? "rotate-180" : ""
                }`}
              />
            </button>
          )}
        </div>

        <button
          className={ICON_BUTTON}
          title="Capture screenshot"
          onClick={() => setPanel("assistant")}
        >
          <Camera />
        </button>

        <span
          className={`h-full w-1.5 shrink-0 self-stretch ${DRAG_CURSOR}`}
          onMouseDown={startIslandDrag}
        />

        <button
          className={GHOST_ICON_BUTTON}
          title="Open diagnostics"
          onClick={() => setPanel(openPanel === "diagnostics" ? null : "diagnostics")}
        >
          {status.icon}
          {!status.icon && <span className="inline-block h-2 w-2 shrink-0 rounded-full bg-white/40" />}
        </button>

        <div
          className={`flex max-w-32 items-center gap-[7px] truncate whitespace-nowrap text-xs font-medium ${DRAG_CURSOR} ${status.className}`}
          onMouseDown={startIslandDrag}
        >
          {status.icon}
          <span className="truncate">{status.label}</span>
        </div>

        <div
          className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-transparent text-white/60 transition-[background,color,transform] duration-150 hover:bg-white/[0.14] active:scale-[0.98] [&_svg]:h-4 [&_svg]:w-4 ${DRAG_CURSOR}`}
          title="Drag island"
          aria-label="Drag island"
          onMouseDown={startIslandDrag}
        >
          <GripVertical />
        </div>
      </section>

      {openPanel && (
        <section
          className={`absolute top-[62px] max-h-[calc(100vh-70px)] w-full overflow-hidden rounded-xl border border-white/10 bg-[rgb(27_27_28_/_0.82)] shadow-[0_18px_48px_rgb(0_0_0_/_0.28)] backdrop-blur-3xl`}
        >
          <div className="flex h-14 items-center justify-between border-b border-white/[0.08] bg-white/[0.04] px-3 py-2.5">
            <div className={`min-w-0 flex-1 ${DRAG_CURSOR}`} onMouseDown={startIslandDrag}>
              <p className="m-0 text-[11px] text-white/60">MVP 0.1</p>
              <h1 className="m-0 text-sm leading-tight">
                {openPanel === "diagnostics" ? "Diagnostics" : "Assistant"}
              </h1>
            </div>
            <button className={GHOST_ICON_BUTTON} onClick={() => setPanel(null)}>
              <ChevronDown className="rotate-180" />
            </button>
          </div>

          <div className="h-[calc(600px-62px-56px)] overflow-auto p-3.5">
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
    <div className="flex h-[26px] w-[116px] shrink-0 items-center gap-1 overflow-hidden" aria-hidden="true">
      {Array.from({ length: 18 }).map((_, index) => (
        <span
          key={index}
          className="min-h-1 w-[3px] rounded-full bg-white/70 [animation:audio-bar-pulse_920ms_ease-in-out_infinite_alternate]"
          style={{ animationDelay: `${index * 55}ms` }}
        />
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
      <div className="mb-3 rounded-xl border border-white/[0.08] bg-white/[0.05] p-3.5">
        <p className="m-0 text-[11px] text-white/60">当前阶段</p>
        <p className="m-0 text-[13px] leading-normal text-white/70">
          这是 0.1 的空灵动岛骨架。音频、STT、LLM、BYOK 会在后续小版本按
          OpenSpec change 逐步接入。
        </p>
      </div>
      <div className="mb-3 grid grid-cols-4 gap-2">
        <button className="h-[34px] rounded-[10px] border border-white/[0.08] bg-white/[0.06] text-white/80 hover:bg-white/10" onClick={() => setState("idle")}>
          Idle
        </button>
        <button className="h-[34px] rounded-[10px] border border-white/[0.08] bg-white/[0.06] text-white/80 hover:bg-white/10" onClick={() => setState("listening")}>
          Listening
        </button>
        <button className="h-[34px] rounded-[10px] border border-white/[0.08] bg-white/[0.06] text-white/80 hover:bg-white/10" onClick={() => setState("thinking")}>
          Thinking
        </button>
        <button className="h-[34px] rounded-[10px] border border-white/[0.08] bg-white/[0.06] text-white/80 hover:bg-white/10" onClick={() => setState("error")}>
          Error
        </button>
      </div>
      <div className="mb-3 rounded-xl border border-white/[0.08] bg-white/[0.05] p-3.5">
        <p className="m-0 text-[11px] text-white/60">Pluely-style 验收</p>
        <ul className="mt-2 list-disc pl-[18px]">
          <li className="text-[13px] leading-normal text-white/70">顶部居中 600 x 54 收起态。</li>
          <li className="text-[13px] leading-normal text-white/70">横向 Card、图标按钮、拖拽手柄。</li>
          <li className="text-[13px] leading-normal text-white/70">展开后保持 600px 宽度，面板从下方出现。</li>
        </ul>
      </div>
      <p className="m-0 text-[11px] text-white/60">Current state: {state}</p>
    </>
  );
}

function Diagnostics() {
  return (
    <div className="grid grid-cols-1 gap-2.5">
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
    <div className="flex items-center gap-2.5 rounded-xl border border-white/[0.08] bg-white/[0.05] p-3">
      <span
        className={`h-[9px] w-[9px] shrink-0 rounded-full ${
          state === "ok" ? "bg-[#38d879]" : "bg-white/30"
        }`}
      />
      <div>
        <p className="m-0 mb-0.5 text-[13px] font-semibold">{label}</p>
        <span className="text-[13px] leading-normal text-white/70">{value}</span>
      </div>
    </div>
  );
}
