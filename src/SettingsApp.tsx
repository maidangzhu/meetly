import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useState } from "react";
import { IndustryPicker } from "./components/IndustryPicker";
import { EMPTY_INDUSTRY_CHOICE, type IndustryChoice } from "./app/industry";
import { OnboardingPanel, type OnboardingStatus } from "./settings/OnboardingPanel";
import { UpdateSection } from "./settings/UpdateSection";

type ProviderKind = "stt" | "llm";
type ProviderId = "openai_compatible" | "xiaomi_mimo";

type ProviderConfig = {
  providerId: ProviderId;
  baseUrl: string;
  model: string;
};

type ProviderDescriptor = {
  id: ProviderId;
  displayName: string;
  description: string;
  defaultBaseUrl: string;
  defaultModel: string;
};

type DiagnosticResult = {
  success: boolean;
  message: string;
};

type WebSearchSettings = {
  enabled: boolean;
  provider: "exa";
  hasApiKey: boolean;
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

const FIELD = "ui-field";
const LABEL = "mb-1 block text-xs font-medium text-white/60";
const PRIMARY_BUTTON = "ui-primary-button";
const SECONDARY_BUTTON = "ui-secondary-button";

function useProviderSection(kind: ProviderKind) {
  const [providerId, setProviderId] = useState<ProviderId>("openai_compatible");
  const [providerOptions, setProviderOptions] = useState<ProviderDescriptor[]>([]);
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
      const [config, options] = await Promise.all([
        invoke<ProviderConfig>("get_provider_config", { kind }),
        invoke<ProviderDescriptor[]>("list_provider_options", { kind }),
      ]);
      setProviderId(config.providerId);
      setProviderOptions(options);
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
        providerId,
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
  }, [kind, providerId, baseUrl, model, apiKey]);

  const selectProvider = (nextProviderId: ProviderId) => {
    setProviderId(nextProviderId);
    const descriptor = providerOptions.find((option) => option.id === nextProviderId);
    if (!descriptor) return;
    setBaseUrl(descriptor.defaultBaseUrl);
    setModel(descriptor.defaultModel);
    setTestResult(null);
  };

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
    providerId,
    providerOptions,
    selectProvider,
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
    <section className="settings-section">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <h2 className="section-title">{title}</h2>
          <p className="mt-1 mb-0 max-w-[560px] text-xs leading-relaxed text-white/44">{description}</p>
        </div>
        <span className={`mt-0.5 text-[11px] ${section.hasStoredKey ? "text-[#b9c6cc]" : "text-white/32"}`}>
          {section.hasStoredKey ? "已配置" : "未配置"}
        </span>
      </div>

      <div className="grid grid-cols-[minmax(0,1.4fr)_minmax(180px,0.8fr)] gap-3">
        <label className="col-span-2">
          <span className={LABEL}>Provider</span>
          <select
            className={FIELD}
            value={section.providerId}
            onChange={(event) => section.selectProvider(event.target.value as ProviderId)}
          >
            {section.providerOptions.map((option) => (
              <option key={option.id} value={option.id}>{option.displayName}</option>
            ))}
          </select>
          <span className="mt-1 block text-[11px] leading-relaxed text-white/38">
            {section.providerOptions.find((option) => option.id === section.providerId)?.description}
          </span>
        </label>
        <label>
          <span className={LABEL}>Base URL</span>
          <input
            className={FIELD}
            value={section.baseUrl}
            onChange={(event) => section.setBaseUrl(event.target.value)}
            placeholder="https://api.siliconflow.cn/v1/..."
          />
        </label>
        <label>
          <span className={LABEL}>Model</span>
          <input
            className={FIELD}
            value={section.model}
            onChange={(event) => section.setModel(event.target.value)}
          />
        </label>
      </div>

      <div className="mt-3 mb-4">
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
        <p className={`mt-2 text-xs ${section.testResult.success ? "text-[#b9c6cc]" : "text-[#ff5c70]"}`}>
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
    <section className="settings-section">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h2 className="section-title">Diagnostics</h2>
          <p className="mt-1 mb-0 text-xs text-white/50">
            Audio and runtime status for local debugging.
          </p>
        </div>
        <button className={SECONDARY_BUTTON} onClick={() => void load()}>
          Refresh
        </button>
      </div>

      <div>
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
    <div className="settings-row">
      <span
        className={`h-4 w-[2px] shrink-0 ${state === "ok" ? "bg-[#9cafb8]" : "bg-white/22"}`}
      />
      <p className="m-0 min-w-[150px] text-[12px] font-medium text-white/62">{label}</p>
      <span className="min-w-0 flex-1 truncate text-right text-[12px] leading-normal text-white/46">{value}</span>
    </div>
  );
}

function IndustrySection() {
  const [choice, setChoice] = useState<IndustryChoice>(EMPTY_INDUSTRY_CHOICE);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    void invoke<IndustryChoice>("get_listening_profile")
      .then((profile) => {
        setChoice({
          presetId: profile.presetId ?? "",
          customText: profile.customText ?? "",
        });
      })
      .catch((error) => {
        setMessage(error instanceof Error ? error.message : String(error));
      });
  }, []);

  const handleChange = (next: IndustryChoice) => {
    setChoice(next);
    setMessage(null);
    void invoke("save_listening_profile", {
      presetId: next.presetId,
      customText: next.customText,
    }).catch((error) => {
      setMessage(error instanceof Error ? error.message : String(error));
    });
  };

  return (
    <section className="settings-section">
      <h2 className="section-title">行业</h2>
      <p className="mt-1 mb-4 text-xs leading-relaxed text-white/44">
        开始聆听前会记住上次的选择。术语按这个行业解释。
      </p>
      <IndustryPicker choice={choice} onChange={handleChange} />
      {message && <p className="mt-2 mb-0 text-xs text-[#ff8b98]">{message}</p>}
    </section>
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
    <div className={compact ? "" : "h-screen w-screen overflow-y-auto bg-[#151718] px-6 py-5"}>
      {!compact && (
        <div className="mb-5">
          <p className="section-label">Meetly</p>
          <h1 className="m-0 mt-1 text-base font-semibold text-white/90">设置</h1>
          <p className="mt-1 mb-0 text-xs text-white/42">行业、转写、语言模型和音频。</p>
        </div>
      )}

      {!onboardingStatus?.completed && (
        <OnboardingPanel
          status={onboardingStatus}
          onCompleted={() => {
            void loadOnboardingStatus();
            onOnboardingCompleted?.();
          }}
        />
      )}

      <div className="settings-stack">
        <IndustrySection />
        <ProviderSection
          title="语音转写"
          description="把远程会议的系统声音和麦克风转成文字。术语卡片用这段转写来触发。"
          kind="stt"
          onSaved={() => void loadOnboardingStatus()}
        />
        <ProviderSection
          title="语言模型"
          description="按所选行业判断转写里有没有需要解释的术语。没有术语时保持安静。"
          kind="llm"
          onSaved={() => void loadOnboardingStatus()}
        />
        <DiagnosticsSection />
        <UpdateSection />
        <FooterActions onQuit={onQuit} />
      </div>
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
    <div className="py-4">
      <button className={SECONDARY_BUTTON} onClick={quit}>
        Quit Meetly
      </button>
    </div>
  );
}
