import { ChevronDown, Eye, EyeOff, GripVertical, Handshake, Mic, MicOff, MonitorUp, Settings } from "lucide-react";
import { AudioBars } from "./components/AudioBars";
import { IndustryPicker } from "./components/IndustryPicker";
import { TermCard } from "./components/TermCard";
import { CARD_SURFACE, DRAG_CURSOR, GHOST_ICON_BUTTON } from "./app/constants";
import type { IndustryChoice } from "./app/industry";
import type { SessionKind } from "./app/sessionAudio";
import { useListeningSession } from "./app/useListeningSession";

export function App() {
  const session = useListeningSession();
  const isListening = session.state === "listening";

  const renderSurface = () => {
    if (session.setupOpen) {
      return (
        <SessionSetup
          captureError={session.transcriptError}
          choice={session.industryChoice}
          isReady={session.isIndustryReady}
          sessionKind={session.sessionKind}
          onChangeIndustry={(choice) => void session.persistIndustry(choice)}
          onClose={() => session.setSetupOpen(false)}
          onSelectKind={session.setSessionKind}
          onStart={() => void session.handleStart()}
          onStartDrag={session.handleStartDrag}
        />
      );
    }

    if (session.hero) {
      return (
        <div className="flex h-full min-h-0 flex-col gap-2">
          <div className="min-h-0 flex-1">
            <TermCard earlier={session.recent} hero={session.hero} industry={session.industryLabel} />
          </div>
          <IslandBar isListening={isListening} session={session} />
        </div>
      );
    }

    return <IslandBar isListening={isListening} session={session} />;
  };

  return (
    <main className="flex h-screen w-screen items-start justify-center overflow-hidden bg-transparent">
      <div className="h-full w-full p-2.5">{renderSurface()}</div>
    </main>
  );
}

function SessionSetup({
  captureError,
  choice,
  isReady,
  onChangeIndustry,
  onClose,
  onSelectKind,
  onStart,
  onStartDrag,
  sessionKind,
}: {
  captureError: string | null;
  choice: IndustryChoice;
  isReady: boolean;
  onChangeIndustry: (choice: IndustryChoice) => void;
  onClose: () => void;
  onSelectKind: (kind: SessionKind) => void;
  onStart: () => void;
  onStartDrag: ReturnType<typeof useListeningSession>["handleStartDrag"];
  sessionKind: SessionKind;
}) {
  return (
    <section className={`flex h-full min-h-0 flex-col overflow-hidden rounded-lg p-4 ${CARD_SURFACE}`} aria-label="开始聆听">
      <div className={`flex items-center justify-between ${DRAG_CURSOR}`} onMouseDown={onStartDrag}>
        <div>
          <p className="m-0 text-[10px] tracking-wide text-white/36">MEETLY</p>
          <h1 className="m-0 text-sm font-semibold text-white/90">先选行业，再开始听</h1>
        </div>
        <button type="button" className={GHOST_ICON_BUTTON} aria-label="收起" onClick={onClose}>
          <ChevronDown />
        </button>
      </div>
      <div className="mt-4 min-h-0 flex-1 overflow-y-auto">
        <p className="section-label">行业</p>
        <div className="mt-2">
          <IndustryPicker choice={choice} onChange={onChangeIndustry} />
        </div>
        <p className="section-label mt-5">声音</p>
        <div className="mt-2 grid grid-cols-2 gap-2" role="radiogroup" aria-label="声音来源">
          {renderKind("remote", "远程会议", "系统声音 + 麦克风", sessionKind === "remote", onSelectKind)}
          {renderKind("in_person", "现场会议", "麦克风", sessionKind === "in_person", onSelectKind)}
        </div>
      </div>
      {captureError && <p className="mt-3 mb-0 text-xs text-[#ff8b98]">{captureError}</p>}
      <div className="mt-4 flex justify-end">
        <button type="button" className="ui-primary-button" disabled={!isReady} onClick={onStart}>
          开始聆听
        </button>
      </div>
    </section>
  );
}

function IslandBar({
  isListening,
  session,
}: {
  isListening: boolean;
  session: ReturnType<typeof useListeningSession>;
}) {
  const status = listeningStatus(isListening, session.audioLevel, session.transcriptError);
  const industry = session.industryLabel || "未选行业";

  return (
    <section
      className={`meetly-island flex h-12 min-w-0 items-center gap-1.5 rounded-lg p-1.5 ${CARD_SURFACE} ${
        isListening ? "w-full" : "mx-auto w-fit"
      }`}
      aria-label="Meetly"
    >
      <button
        type="button"
        className={`voice-launch-button ${isListening ? "voice-launch-button--active" : ""}`}
        aria-label={isListening ? "结束聆听" : "开始聆听"}
        onClick={session.handleToggleSession}
      >
        {isListening ? <MicOff /> : <Mic />}
      </button>
      {isListening ? (
        <div className="flex h-9 min-w-0 flex-1 items-center gap-2 px-1">
          <AudioBars level={session.audioLevel} tone="cool" />
          <p className="m-0 min-w-0 flex-1 truncate text-[13px] text-white/72">
            {status} · {industry}
            {session.transcriptError ? ` · ${session.transcriptError}` : ""}
          </p>
        </div>
      ) : (
        <p className="m-0 max-w-[220px] truncate px-1 text-[13px] text-white/62">{industry}</p>
      )}
      {session.notice && <p className="m-0 max-w-[180px] truncate text-[11px] text-white/46">{session.notice}</p>}
      <button
        type="button"
        className={`voice-toolbar-button ${session.isStealthOn ? "voice-toolbar-button--active" : ""}`}
        aria-label={session.isStealthOn ? "已开启防截屏" : "防截屏"}
        aria-pressed={session.isStealthOn}
        onClick={() => void session.handleToggleStealth()}
      >
        {session.isStealthOn ? <EyeOff /> : <Eye />}
      </button>
      <button type="button" className="voice-toolbar-button" aria-label="设置" onClick={() => void session.handleOpenSettings()}>
        <Settings />
      </button>
      <div className={`voice-toolbar-button ${DRAG_CURSOR}`} aria-label="拖动" onMouseDown={session.handleStartDrag}>
        <GripVertical />
      </div>
    </section>
  );
}

const listeningStatus = (isListening: boolean, audioLevel: number, transcriptError: string | null) => {
  if (!isListening) return "未在听";
  if (transcriptError) return "转写异常";
  if (audioLevel > 0.015) return "正在听";
  return "等待语音";
};

const renderKind = (
  kind: SessionKind,
  label: string,
  detail: string,
  selected: boolean,
  onSelect: (kind: SessionKind) => void,
) => (
  <button
    key={kind}
    type="button"
    role="radio"
    aria-checked={selected}
    className={`rounded-md border px-3 py-2 text-left ${
      selected ? "border-[#d7b09a]/70 bg-[#c17f59]/12" : "border-white/10 bg-white/[0.02]"
    }`}
    onClick={() => onSelect(kind)}
  >
    <span className="flex items-center gap-2 text-sm text-white/86">
      {kind === "remote" ? <MonitorUp className="h-4 w-4" /> : <Handshake className="h-4 w-4" />}
      {label}
    </span>
    <span className="mt-1 block text-[11px] text-white/42">{detail}</span>
  </button>
);
