import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useState } from "react";
import { OnboardingPanel, type OnboardingStatus } from "./settings/OnboardingPanel";
import { UpdateSection } from "./settings/UpdateSection";
import type { DictationSettings, DictationStatus } from "./app/dictation/types";
import { DEFAULT_DICTATION_SETTINGS } from "./app/dictation/types";

type ProviderKind = "stt" | "llm";

type ProviderConfig = {
  baseUrl: string;
  model: string;
};

type DiagnosticResult = {
  success: boolean;
  message: string;
};

type AudioRunState = "idle" | "listening" | "setup_required" | "error";

type AudioStatus = {
  state: AudioRunState;
  platform: string;
  inputDevice: string | null;
  outputDevice: string | null;
  sampleRate: number | null;
  level: number;
  setupRequired: boolean;
  message: string | null;
};

const FIELD =
  "w-full rounded-lg border border-white/10 bg-white/[0.06] px-3 py-2 text-sm text-[#f5f5f5] placeholder:text-white/30 focus:outline-none focus:ring-1 focus:ring-white/20";
const LABEL = "mb-1 block text-xs font-medium text-white/60";
const PRIMARY_BUTTON =
  "rounded-lg bg-white/90 px-3 py-2 text-sm font-medium text-black transition-[background,transform] duration-150 hover:bg-white active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50";
const SECONDARY_BUTTON =
  "rounded-lg border border-white/15 bg-white/[0.06] px-3 py-2 text-sm text-white/80 transition-[background,transform] duration-150 hover:bg-white/[0.12] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50";

function useProviderSection(kind: ProviderKind) {
  const [baseUrl, setBaseUrl] = useState("");
  const [model, setModel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [hasStoredKey, setHasStoredKey] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<DiagnosticResult | null>(null);

  const load = useCallback(async () => {
    try {
      const config = await invoke<ProviderConfig>("get_provider_config", { kind });
      setBaseUrl(config.baseUrl);
      setModel(config.model);
      const stored = await invoke<boolean>("has_api_key", { kind });
      setHasStoredKey(stored);
    } catch (error) {
      console.error(`Failed to load ${kind} config:`, error);
    }
  }, [kind]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = useCallback(async () => {
    setIsSaving(true);
    setSaveMessage(null);
    try {
      await invoke("save_provider_config", {
        kind,
        baseUrl,
        model,
        apiKey,
      });
      if (apiKey.trim()) {
        setHasStoredKey(true);
        setApiKey("");
      }
      setSaveMessage("Saved.");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setSaveMessage(`Failed to save: ${message}`);
    } finally {
      setIsSaving(false);
    }
  }, [kind, baseUrl, model, apiKey]);

  const test = useCallback(async () => {
    setIsTesting(true);
    setTestResult(null);
    try {
      const command = kind === "stt" ? "test_stt_config" : "test_llm_config";
      const result = await invoke<DiagnosticResult>(command);
      setTestResult(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setTestResult({ success: false, message });
    } finally {
      setIsTesting(false);
    }
  }, [kind]);

  return {
    baseUrl,
    setBaseUrl,
    model,
    setModel,
    apiKey,
    setApiKey,
    hasStoredKey,
    isSaving,
    isTesting,
    saveMessage,
    testResult,
    save,
    test,
  };
}

export function ProviderSection({
  title,
  description,
  kind,
  onSaved,
}: {
  title: string;
  description: string;
  kind: ProviderKind;
  onSaved?: () => void;
}) {
  const section = useProviderSection(kind);
  const save = async () => {
    await section.save();
    onSaved?.();
  };

  return (
    <section className="mb-6 rounded-xl border border-white/[0.08] bg-white/[0.04] p-4">
      <h2 className="m-0 text-sm font-semibold">{title}</h2>
      <p className="mt-1 mb-4 text-xs text-white/50">{description}</p>

      <div className="mb-3">
        <label className={LABEL}>Base URL</label>
        <input
          className={FIELD}
          value={section.baseUrl}
          onChange={(event) => section.setBaseUrl(event.target.value)}
          placeholder="https://api.siliconflow.cn/v1/..."
        />
      </div>

      <div className="mb-3">
        <label className={LABEL}>Model</label>
        <input
          className={FIELD}
          value={section.model}
          onChange={(event) => section.setModel(event.target.value)}
        />
      </div>

      <div className="mb-4">
        <label className={LABEL}>
          API Key {section.hasStoredKey && <span className="text-white/40">(saved — leave blank to keep)</span>}
        </label>
        <input
          className={FIELD}
          type="password"
          value={section.apiKey}
          onChange={(event) => section.setApiKey(event.target.value)}
          placeholder={section.hasStoredKey ? "••••••••" : "sk-..."}
        />
      </div>

      <div className="flex items-center gap-2">
        <button className={PRIMARY_BUTTON} disabled={section.isSaving} onClick={() => void save()}>
          {section.isSaving ? "Saving..." : "Save"}
        </button>
        <button className={SECONDARY_BUTTON} disabled={section.isTesting} onClick={() => void section.test()}>
          {section.isTesting ? "Testing..." : "Test connection"}
        </button>
      </div>

      {section.saveMessage && (
        <p className="mt-2 text-xs text-white/60">{section.saveMessage}</p>
      )}
      {section.testResult && (
        <p className={`mt-2 text-xs ${section.testResult.success ? "text-[#38d879]" : "text-[#ff5c70]"}`}>
          {section.testResult.message}
        </p>
      )}
    </section>
  );
}

export function DiagnosticsSection() {
  const [audioStatus, setAudioStatus] = useState<AudioStatus | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setMessage(null);
    try {
      const status = await invoke<AudioStatus>("get_audio_status");
      setAudioStatus(status);
    } catch (error) {
      const nextMessage = error instanceof Error ? error.message : String(error);
      setMessage(nextMessage);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <section className="mb-6 rounded-xl border border-white/[0.08] bg-white/[0.04] p-4">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h2 className="m-0 text-sm font-semibold">Diagnostics</h2>
          <p className="mt-1 mb-0 text-xs text-white/50">
            Audio and runtime status for local debugging.
          </p>
        </div>
        <button className={SECONDARY_BUTTON} onClick={() => void load()}>
          Refresh
        </button>
      </div>

      <div className="grid grid-cols-1 gap-2.5">
        <DiagnosticItem label="Tauri shell" value="Ready" state="ok" />
        <DiagnosticItem
          label="Audio state"
          value={audioStatus ? audioStatus.state : "Checking..."}
          state={audioStatus?.setupRequired ? "pending" : "ok"}
        />
        <DiagnosticItem
          label="Output device"
          value={audioStatus?.outputDevice ?? "Not found"}
          state={audioStatus?.outputDevice ? "ok" : "pending"}
        />
        <DiagnosticItem
          label="Input device"
          value={audioStatus?.inputDevice ?? "Not found"}
          state={audioStatus?.inputDevice ? "ok" : "pending"}
        />
        <DiagnosticItem
          label="Sample rate"
          value={audioStatus?.sampleRate ? `${audioStatus.sampleRate} Hz` : "Not active"}
          state={audioStatus?.sampleRate ? "ok" : "pending"}
        />
        <DiagnosticItem
          label="Audio level"
          value={audioStatus ? audioStatus.level.toFixed(3) : "Unknown"}
          state={audioStatus?.state === "listening" ? "ok" : "pending"}
        />
        <DiagnosticItem
          label="Platform"
          value={audioStatus?.platform ?? "Unknown"}
          state={audioStatus ? "ok" : "pending"}
        />
        {audioStatus?.message && (
          <DiagnosticItem label="Audio message" value={audioStatus.message} state="pending" />
        )}
        {message && <DiagnosticItem label="Diagnostics error" value={message} state="pending" />}
      </div>
    </section>
  );
}

function DictationSection() {
  const [settings, setSettings] = useState<DictationSettings>(DEFAULT_DICTATION_SETTINGS);
  const [status, setStatus] = useState<DictationStatus | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isTesting, setIsTesting] = useState(false);

  const load = useCallback(async () => {
    try {
      const next = await invoke<DictationStatus>("get_dictation_status");
      setStatus(next);
      setSettings(next.settings);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    setIsSaving(true);
    setMessage(null);
    try {
      const next = await invoke<DictationStatus>("save_dictation_settings", { settings });
      setStatus(next);
      setSettings(next.settings);
      setMessage("Voice dictation settings saved.");
    } catch (error) {
      setMessage(`Failed to save: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setIsSaving(false);
    }
  };

  const testPaste = async () => {
    setIsTesting(true);
    setMessage(null);
    try {
      const result = await invoke<{ pasted: boolean; message: string }>("test_dictation_paste");
      setMessage(result.pasted ? "Paste test completed." : result.message);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setIsTesting(false);
    }
  };

  return (
    <section className="mb-6 rounded-xl border border-white/[0.08] bg-white/[0.04] p-4">
      <h2 className="m-0 text-sm font-semibold">Voice shortcuts</h2>
      <p className="mt-1 mb-4 text-xs leading-relaxed text-white/50">
        Press Fn + Space twice to dictate. Hold Fn to ask AI, then release to submit. Press Escape to cancel.
      </p>

      <label className="mb-3 flex items-center justify-between gap-3 rounded-lg border border-white/[0.08] bg-white/[0.04] p-3 text-sm">
        <span>
          <span className="block text-[13px] font-medium">Enable voice shortcuts</span>
          <span className="block text-xs text-white/45">Dictation and Voice Ask run independently from Meeting and Coach.</span>
        </span>
        <input
          type="checkbox"
          checked={settings.enabled}
          onChange={(event) => setSettings((current) => ({ ...current, enabled: event.target.checked }))}
        />
      </label>

      <div className="mb-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label>
          <span className={LABEL}>Primary shortcut</span>
          <input
            className={FIELD}
            value={settings.shortcut}
            onChange={(event) => setSettings((current) => ({ ...current, shortcut: event.target.value }))}
            placeholder="Fn+Space"
          />
        </label>
        <label>
          <span className={LABEL}>Fallback shortcut</span>
          <input
            className={FIELD}
            value={settings.fallbackShortcut}
            onChange={(event) => setSettings((current) => ({ ...current, fallbackShortcut: event.target.value }))}
            placeholder="Alt+Space"
          />
        </label>
      </div>

      <div className="mb-4 grid grid-cols-1 gap-2">
        <DictationToggle
          label="AI polish"
          description="Remove filler and fix punctuation without adding new ideas."
          checked={settings.aiPolishEnabled}
          onChange={(checked) => setSettings((current) => ({ ...current, aiPolishEnabled: checked }))}
        />
        <DictationToggle
          label="Auto paste"
          description="Paste into the app that was active when dictation started."
          checked={settings.autoPasteEnabled}
          onChange={(checked) => setSettings((current) => ({ ...current, autoPasteEnabled: checked }))}
        />
        <DictationToggle
          label="Keep result in clipboard"
          description="Leaves the final text available if automatic paste fails."
          checked={settings.keepResultInClipboard}
          onChange={(checked) => setSettings((current) => ({ ...current, keepResultInClipboard: checked }))}
        />
      </div>

      <div className="mb-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
        <DiagnosticItem
          label="Microphone access"
          value={formatMicrophonePermission(status?.microphonePermission)}
          state={status?.microphonePermission === "authorized" ? "ok" : "pending"}
        />
        <DiagnosticItem
          label="Keyboard access"
          value={status?.accessibilityGranted ? "Granted" : "Required for Fn and auto paste"}
          state={status?.accessibilityGranted ? "ok" : "pending"}
        />
        <DiagnosticItem
          label="Shortcut backend"
          value={status?.shortcutBackend ?? "Checking..."}
          state={status?.shortcutBackend && status.shortcutBackend !== "unavailable" ? "ok" : "pending"}
        />
      </div>

      {status?.shortcutError && <p className="mb-3 text-xs text-[#ff9ba8]">{status.shortcutError}</p>}

      <div className="flex flex-wrap items-center gap-2">
        <button className={PRIMARY_BUTTON} disabled={isSaving} onClick={() => void save()}>
          {isSaving ? "Saving..." : "Save dictation"}
        </button>
        {!status?.accessibilityGranted && (
          <button
            className={SECONDARY_BUTTON}
            onClick={() =>
              void invoke("request_dictation_accessibility")
                .then(load)
                .catch((error) => setMessage(error instanceof Error ? error.message : String(error)))
            }
          >
            Open Keyboard Access
          </button>
        )}
        <button className={SECONDARY_BUTTON} disabled={isTesting} onClick={() => void testPaste()}>
          {isTesting ? "Testing..." : "Test paste"}
        </button>
      </div>
      {message && <p className="mt-2 mb-0 text-xs text-white/60">{message}</p>}
    </section>
  );
}

function formatMicrophonePermission(permission: DictationStatus["microphonePermission"] | undefined) {
  switch (permission) {
    case "authorized":
      return "Granted";
    case "not_determined":
      return "Will ask on first recording";
    case "denied":
      return "Denied in System Settings";
    case "restricted":
      return "Restricted by macOS";
    case "unknown":
      return "Unknown";
    default:
      return "Checking...";
  }
}

function DictationToggle({
  checked,
  description,
  label,
  onChange,
}: {
  checked: boolean;
  description: string;
  label: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex items-center justify-between gap-3 rounded-lg border border-white/[0.08] bg-white/[0.04] px-3 py-2.5">
      <span>
        <span className="block text-[13px] font-medium">{label}</span>
        <span className="block text-xs text-white/45">{description}</span>
      </span>
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
    </label>
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
    <div className="flex items-center gap-2.5 rounded-lg border border-white/[0.08] bg-white/[0.05] p-3">
      <span
        className={`h-[9px] w-[9px] shrink-0 rounded-full ${
          state === "ok" ? "bg-[#38d879]" : "bg-white/30"
        }`}
      />
      <div className="min-w-0">
        <p className="m-0 mb-0.5 text-[13px] font-semibold">{label}</p>
        <span className="block truncate text-[13px] leading-normal text-white/70">{value}</span>
      </div>
    </div>
  );
}

export function SettingsContent({
  compact = false,
  onOnboardingCompleted,
  onQuit,
}: {
  compact?: boolean;
  onOnboardingCompleted?: () => void;
  onQuit?: () => void;
}) {
  const [onboardingStatus, setOnboardingStatus] = useState<OnboardingStatus | null>(null);

  const loadOnboardingStatus = useCallback(async () => {
    try {
      const status = await invoke<OnboardingStatus>("get_onboarding_status");
      setOnboardingStatus(status);
    } catch (error) {
      console.error("Failed to load onboarding status:", error);
    }
  }, []);

  useEffect(() => {
    void loadOnboardingStatus();
  }, [loadOnboardingStatus]);

  return (
    <div className={compact ? "" : "h-screen w-screen overflow-y-auto bg-[#1b1b1c] p-5"}>
      <h1 className="m-0 mb-1 text-base font-semibold">Meetly Settings</h1>
      <p className="mt-0 mb-5 text-xs text-white/50">
        Configure the STT and LLM providers used for transcription and
        suggestions. API keys are stored in the local development secrets
        file.
      </p>

      {!onboardingStatus?.completed && (
        <OnboardingPanel
          status={onboardingStatus}
          onCompleted={() => {
            void loadOnboardingStatus();
            onOnboardingCompleted?.();
          }}
        />
      )}

      <ProviderSection
        title="Speech-to-text"
        description="Used to transcribe microphone audio segments. Any OpenAI-Whisper-compatible endpoint works."
        kind="stt"
        onSaved={() => void loadOnboardingStatus()}
      />
      <ProviderSection
        title="Assistant (LLM)"
        description="Used to generate Ask suggestions from recent transcript. Any OpenAI-compatible chat completions endpoint works."
        kind="llm"
        onSaved={() => void loadOnboardingStatus()}
      />
      <DictationSection />
      <DiagnosticsSection />
      <UpdateSection />
      <FooterActions onQuit={onQuit} />
    </div>
  );
}

export function SettingsApp() {
  return <SettingsContent />;
}

function FooterActions({ onQuit }: { onQuit?: () => void }) {
  const quit = () => {
    if (onQuit) {
      onQuit();
      return;
    }
    void invoke("quit_app");
  };

  return (
    <div className="pb-2">
      <button className={SECONDARY_BUTTON} onClick={quit}>
        Quit Meetly
      </button>
    </div>
  );
}
