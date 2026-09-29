import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useCallback, useEffect, useRef, useState, type MouseEvent } from "react";
import {
  EMPTY_INDUSTRY_CHOICE,
  isIndustryReady,
  resolveIndustryLabel,
  type IndustryChoice,
} from "./industry";
import { debugLog, isTauriRuntime, safeInvoke } from "./platform";
import type { SessionKind } from "./sessionAudio";
import { earlierTerms, heroTerm, recordDetectedTerms, type ExplainedTerm } from "./terms";

type AudioLevelChanged = {
  source?: "system" | "microphone";
  level: number;
};

type TranscriptSegment = {
  text: string;
};

type TranscriptError = {
  message: string;
};

type MeetingCaptureStatus = {
  system: { ready: boolean; message: string | null };
  microphone: { ready: boolean; message: string | null };
};

type TermDetection = {
  terms: Array<{ term: string; explanation: string }>;
};

const BAR_HEIGHT = 54;
const SETUP_HEIGHT = 560;
const TERM_CARD_HEIGHT = 520;

export function useListeningSession() {
  const [state, setState] = useState<"idle" | "listening" | "error">("idle");
  const [setupOpen, setSetupOpen] = useState(false);
  const [industryChoice, setIndustryChoice] = useState<IndustryChoice>(EMPTY_INDUSTRY_CHOICE);
  const [sessionKind, setSessionKind] = useState<SessionKind>("remote");
  const [audioLevel, setAudioLevel] = useState(0);
  const [transcriptError, setTranscriptError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [terms, setTerms] = useState<ExplainedTerm[]>([]);
  const [isStealthOn, setIsStealthOn] = useState(false);
  const generationRef = useRef(0);
  const listeningRef = useRef(false);
  const industryLabelRef = useRef("");

  const industryLabel = resolveIndustryLabel(industryChoice);
  industryLabelRef.current = industryLabel;
  const hero = heroTerm(terms);
  const recent = earlierTerms(terms);

  const resizeIsland = useCallback(async (height: number) => {
    await safeInvoke("set_island_height", { height });
  }, []);

  useEffect(() => {
    let mounted = true;
    void safeInvoke<IndustryChoice>("get_listening_profile").then((profile) => {
      if (!mounted || !profile) return;
      setIndustryChoice({
        presetId: profile.presetId ?? "",
        customText: profile.customText ?? "",
      });
    });
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    const height = setupOpen ? SETUP_HEIGHT : hero ? TERM_CARD_HEIGHT : BAR_HEIGHT;
    void resizeIsland(height);
  }, [hero, resizeIsland, setupOpen]);

  const explainTerms = async (industry: string, transcript: string, generation: number) => {
    try {
      const result = await safeInvoke<TermDetection>("explain_transcript_terms", {
        industry,
        transcript,
      });
      if (!result || generation !== generationRef.current) return;
      setTerms((current) => recordDetectedTerms(current, result.terms ?? []));
    } catch (error) {
      if (generation !== generationRef.current) return;
      const message = error instanceof Error ? error.message : String(error);
      debugLog(`[terms] request failed message=${message}`);
      if (/key|api|credential|未配置/i.test(message)) {
        setNotice("请先在设置中保存语言模型的 API Key");
      }
    }
  };

  useEffect(() => {
    if (!isTauriRuntime()) return;

    let disposed = false;
    const levels = { system: 0, microphone: 0 };
    let unlistenLevel: (() => void) | undefined;
    let unlistenFinal: (() => void) | undefined;
    let unlistenError: (() => void) | undefined;

    void listen<AudioLevelChanged>("audio_level_changed", (event) => {
      if (disposed) return;
      const source = event.payload.source ?? "system";
      levels[source] = event.payload.level;
      setAudioLevel(Math.max(levels.system, levels.microphone));
    }).then((unlisten) => {
      if (disposed) unlisten();
      else unlistenLevel = unlisten;
    });

    void listen<TranscriptSegment>("transcript_final", (event) => {
      if (disposed || !listeningRef.current) return;
      const generation = generationRef.current;
      const industry = industryLabelRef.current;
      const text = event.payload.text.trim();
      if (!industry || text.length < 2) return;
      void explainTerms(industry, text, generation);
    }).then((unlisten) => {
      if (disposed) unlisten();
      else unlistenFinal = unlisten;
    });

    void listen<TranscriptError>("transcript_error", (event) => {
      if (!disposed) setTranscriptError(event.payload.message);
    }).then((unlisten) => {
      if (disposed) unlisten();
      else unlistenError = unlisten;
    });

    return () => {
      disposed = true;
      unlistenLevel?.();
      unlistenFinal?.();
      unlistenError?.();
    };
  }, []);

  useEffect(() => {
    return () => {
      listeningRef.current = false;
      generationRef.current += 1;
      void safeInvoke("stop_meeting_capture");
      void safeInvoke("set_island_meeting_active", { active: false });
    };
  }, []);

  const persistIndustry = async (choice: IndustryChoice) => {
    setIndustryChoice(choice);
    await safeInvoke("save_listening_profile", {
      presetId: choice.presetId,
      customText: choice.customText,
    });
  };

  const handleOpenSetup = async () => {
    const profile = await safeInvoke<IndustryChoice>("get_listening_profile");
    if (profile) {
      setIndustryChoice({
        presetId: profile.presetId ?? "",
        customText: profile.customText ?? "",
      });
    }
    setSetupOpen(true);
  };

  const handleStart = async () => {
    if (!isIndustryReady(industryChoice)) return;
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    setTerms([]);
    setTranscriptError(null);
    setNotice(null);
    setSetupOpen(false);
    debugLog(`[audio] start requested kind=${sessionKind} industry=${industryLabel}`);

    try {
      const remote = sessionKind === "remote";
      const capture = await safeInvoke<MeetingCaptureStatus>("start_meeting_capture", { remote });
      if (!capture || (!capture.system.ready && !capture.microphone.ready)) {
        const message = [capture?.system.message, capture?.microphone.message].filter(Boolean).join("；");
        throw new Error(message || "没有可用的音频通道");
      }
      listeningRef.current = true;
      setState("listening");
      await safeInvoke("set_island_meeting_active", { active: true });
      const degraded = [
        remote && !capture.system.ready ? capture.system.message : null,
        !capture.microphone.ready ? capture.microphone.message : null,
      ].filter(Boolean);
      setTranscriptError(degraded.length > 0 ? degraded.join("；") : null);
    } catch (error) {
      listeningRef.current = false;
      const message = error instanceof Error ? error.message : String(error);
      setTranscriptError(message);
      setState("error");
      setSetupOpen(true);
      await safeInvoke("set_island_meeting_active", { active: false });
    }
  };

  const handleStop = async () => {
    listeningRef.current = false;
    generationRef.current += 1;
    await safeInvoke("stop_meeting_capture");
    setAudioLevel(0);
    setState("idle");
    setTerms([]);
    setSetupOpen(false);
    await safeInvoke("set_island_meeting_active", { active: false });
  };

  const handleToggleSession = () => {
    if (state === "listening") {
      void handleStop();
      return;
    }
    void handleOpenSetup();
  };

  const handleToggleStealth = async () => {
    const next = !isStealthOn;
    try {
      await safeInvoke("set_stealth", { enabled: next });
      setIsStealthOn(next);
    } catch (error) {
      debugLog(`[stealth] toggle failed message=${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const handleOpenSettings = async () => {
    await safeInvoke("open_settings_window");
  };

  const handleStartDrag = async (event: MouseEvent<HTMLElement>) => {
    if (event.button !== 0 || !isTauriRuntime()) return;
    event.preventDefault();
    try {
      await getCurrentWindow().startDragging();
    } catch (error) {
      debugLog(`[island] drag failed message=${error instanceof Error ? error.message : String(error)}`);
    }
  };

  return {
    audioLevel,
    handleOpenSettings,
    handleStart,
    handleStartDrag,
    handleStop,
    handleToggleSession,
    handleToggleStealth,
    hero,
    industryChoice,
    industryLabel,
    isIndustryReady: isIndustryReady(industryChoice),
    isStealthOn,
    notice,
    persistIndustry,
    recent,
    sessionKind,
    setSessionKind,
    setSetupOpen,
    setupOpen,
    state,
    transcriptError,
  };
}
