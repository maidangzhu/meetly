import { useCallback, useMemo, type MouseEvent } from "react";
import { AlertCircle, Loader2 } from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { isTauriRuntime, safeInvoke } from "./platform";
import type { OpenPanel } from "./types";
import type { MeetlyState } from "./useMeetlyState";

export function useWindowActions(ctx: MeetlyState) {
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

  const setPanel = useCallback(async (panel: OpenPanel) => {
    ctx.setOpenPanel(panel);
    if (panel === null && isTauriRuntime()) {
      const window = getCurrentWindow();
      if (await window.isMaximized()) {
        await window.unmaximize();
      }
    }
    await resizeIsland(panel !== null);
  }, [ctx, resizeIsland]);

  const toggleWorkspaceMaximized = useCallback(async () => {
    if (!isTauriRuntime()) return;
    try {
      await getCurrentWindow().toggleMaximize();
    } catch (error) {
      console.error("Failed to resize workspace:", error);
    }
  }, []);

  const closeWorkspace = useCallback(async () => {
    await safeInvoke("set_island_visible", { visible: false });
  }, []);

  const toggleStealth = useCallback(async () => {
    const next = !ctx.isStealthOn;
    try {
      await safeInvoke("set_stealth", { enabled: next });
      ctx.setIsStealthOn(next);
    } catch (error) {
      console.error("Failed to toggle stealth mode:", error);
    }
  }, [ctx]);

  const openSettings = useCallback(async () => {
    await setPanel("settings");
  }, [setPanel]);

  const status = useMemo(() => {
    if (ctx.state === "error") {
      return {
        icon: <AlertCircle className="h-3.5 w-3.5 text-[#ff5c70]" />,
        label: "需要处理",
        className: "text-[#ff5c70]",
      };
    }

    if (ctx.state === "thinking" || ctx.state === "transcribing") {
      return {
        icon: <Loader2 className="h-3.5 w-3.5 animate-spin" />,
        label: ctx.state === "thinking" ? "准备中" : "转写中",
        className: "text-white/70",
      };
    }

    if (ctx.state === "listening") {
      return {
        icon: (
          <span className="inline-block h-2 w-2 shrink-0 rounded-full bg-[#38d879] shadow-[0_0_0_0_rgb(56_216_121_/_0.42)] [animation:listening-dot-pulse_1.4s_infinite]" />
        ),
        label: ctx.sessionKind === "remote" ? "远程会议中" : "现场会议中",
        className: "text-[#38d879]",
      };
    }

    return {
      icon: null,
      label: "",
      className: "",
    };
  }, [ctx.sessionKind, ctx.state]);

  return {
    closeWorkspace,
    openSettings,
    resizeIsland,
    setPanel,
    startIslandDrag,
    status,
    toggleStealth,
    toggleWorkspaceMaximized,
  };
}

export type WindowActions = ReturnType<typeof useWindowActions>;
