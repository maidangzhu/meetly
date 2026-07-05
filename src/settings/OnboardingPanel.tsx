import { invoke } from "@tauri-apps/api/core";
import { CheckCircle2, KeyRound, Mic, Power, ShieldCheck } from "lucide-react";
import type { ReactNode } from "react";

export type OnboardingStatus = {
  completed: boolean;
  hasSttKey: boolean;
  hasLlmKey: boolean;
};

const PRIMARY_BUTTON =
  "rounded-lg bg-white/90 px-3 py-2 text-sm font-medium text-black transition-[background,transform] duration-150 hover:bg-white active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50";
const SECONDARY_BUTTON =
  "rounded-lg border border-white/15 bg-white/[0.06] px-3 py-2 text-sm text-white/80 transition-[background,transform] duration-150 hover:bg-white/[0.12] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50";

export function OnboardingPanel({
  onCompleted,
  status,
}: {
  onCompleted: () => void;
  status: OnboardingStatus | null;
}) {
  const canEnter = Boolean(status?.hasSttKey && status?.hasLlmKey);

  const openUrl = (url: string) => {
    void invoke("open_external_url", { url });
  };

  const complete = async () => {
    await invoke("complete_onboarding");
    onCompleted();
  };

  const quit = () => {
    void invoke("quit_app");
  };

  return (
    <section className="mb-6 rounded-xl border border-white/[0.08] bg-white/[0.04] p-4">
      <div className="mb-5">
        <p className="m-0 text-[11px] font-medium uppercase tracking-[0.12em] text-[#38d879]">
          Native macOS assistant
        </p>
        <h2 className="m-0 mt-1 text-lg font-semibold">开始使用 Meetly</h2>
        <p className="mt-1 mb-0 text-xs leading-relaxed text-white/52">
          先完成权限和 Provider 配置。之后点击悬浮岛左侧开始按钮，就可以进入持续面试监听。
        </p>
      </div>

      <div className="grid gap-3">
        <SetupStep
          icon={<Mic />}
          title="打开麦克风权限"
          description="Meetly 当前主路径通过麦克风持续监听面试/对话。首次点击开始时，macOS 会弹出麦克风权限。"
          done={false}
          action={
            <button
              className={SECONDARY_BUTTON}
              onClick={() => openUrl("x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone")}
            >
              打开权限设置
            </button>
          }
        />

        <SetupStep
          icon={<ShieldCheck />}
          title="了解隐藏模式"
          description="Undetectable 会尽量避免悬浮窗被常见截图/录屏捕获，但不同会议软件行为不同，不能承诺 100% 不可见。"
          done
          action={
            <button
              className={SECONDARY_BUTTON}
              onClick={() => openUrl("x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture")}
            >
              屏幕录制设置
            </button>
          }
        />

        <SetupStep
          icon={<KeyRound />}
          title="配置 STT 和 LLM API Key"
          description="可以从硅基流动获取语音转写 key，也可以从 DeepSeek 等 OpenAI-compatible 平台获取 LLM key。"
          done={canEnter}
          action={
            <div className="flex flex-wrap gap-2">
              <button className={SECONDARY_BUTTON} onClick={() => openUrl("https://cloud.siliconflow.cn/")}>
                硅基流动
              </button>
              <button className={SECONDARY_BUTTON} onClick={() => openUrl("https://platform.deepseek.com/")}>
                DeepSeek
              </button>
            </div>
          }
        />
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-2">
        <button className={PRIMARY_BUTTON} disabled={!canEnter} onClick={() => void complete()}>
          进入 Meetly
        </button>
        <button className={SECONDARY_BUTTON} onClick={quit}>
          <Power className="mr-1 inline h-3.5 w-3.5 align-[-2px]" />
          退出
        </button>
        {!canEnter && (
          <span className="text-xs text-white/42">保存 STT 和 LLM key 后就可以进入。</span>
        )}
      </div>
    </section>
  );
}

function SetupStep({
  action,
  description,
  done,
  icon,
  title,
}: {
  action: ReactNode;
  description: string;
  done: boolean;
  icon: ReactNode;
  title: string;
}) {
  return (
    <div className="flex gap-3 rounded-lg border border-white/[0.08] bg-white/[0.045] p-3">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/[0.08] text-white/75 [&_svg]:h-4 [&_svg]:w-4">
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <h3 className="m-0 text-sm font-semibold">{title}</h3>
          {done && <CheckCircle2 className="h-3.5 w-3.5 text-[#38d879]" />}
        </div>
        <p className="mt-1 mb-2 text-xs leading-relaxed text-white/50">{description}</p>
        {action}
      </div>
    </div>
  );
}
