import { invoke } from "@tauri-apps/api/core";
import { ArrowRight, CheckCircle2, KeyRound, Mic, Power, ShieldCheck, Sparkles } from "lucide-react";
import { useState } from "react";
import type { ReactNode } from "react";

export type OnboardingStatus = {
  completed: boolean;
  hasSttKey: boolean;
  hasLlmKey: boolean;
};

const PRIMARY_BUTTON = "ui-primary-button";
const SECONDARY_BUTTON = "ui-secondary-button";

export function OnboardingPanel({
  onCompleted,
  status,
}: {
  onCompleted: () => void;
  status: OnboardingStatus | null;
}) {
  const [step, setStep] = useState<"welcome" | "setup">("welcome");
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

  if (step === "welcome") {
    return (
      <section className="mb-5 flex min-h-[390px] flex-col border-y border-white/[0.08] py-5">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-[#c17f59]/25 bg-[#c17f59]/10 text-[#d0a083] [&_svg]:h-4 [&_svg]:w-4">
          <Sparkles />
        </div>
        <div className="mt-6 max-w-[430px]">
          <p className="section-label">Welcome to Meetly</p>
          <h2 className="m-0 mt-2 text-xl font-semibold leading-tight text-white/92">一个始终在手边的语音入口。</h2>
          <p className="mt-3 mb-0 text-sm leading-relaxed text-white/52">
            Meetly 将语音输入、实时上下文与主动式 AI 放在同一个本地桌面入口里。
          </p>
        </div>

        <div className="mt-6 border-t border-white/[0.07] text-sm text-white/58">
          <WelcomeLine>顶部浮岛保持安静，只在需要时展开。</WelcomeLine>
          <WelcomeLine>语音输入、Ask 与持续会话彼此独立。</WelcomeLine>
          <WelcomeLine>模型和数据保留在你的本地配置边界内。</WelcomeLine>
        </div>

        <div className="mt-auto flex justify-end pt-6">
          <button className={PRIMARY_BUTTON} onClick={() => setStep("setup")}>
            Get Started
            <ArrowRight className="ml-1 inline h-3.5 w-3.5 align-[-2px]" />
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="mb-5 border-y border-white/[0.08] py-5">
      <div className="mb-5">
        <p className="section-label">Setup</p>
        <h2 className="m-0 mt-1 text-lg font-semibold">开通权限并连接模型</h2>
        <p className="mt-1 mb-0 text-xs leading-relaxed text-white/52">
          完成后点击进入，设置窗口会关闭，只保留屏幕顶部的悬浮岛。首次开始监听时，macOS 会弹出麦克风授权。
        </p>
      </div>

      <div className="border-t border-white/[0.07]">
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
          <span className="text-xs text-white/42">先在下方保存 STT 和 LLM key，按钮就会亮起。</span>
        )}
      </div>
    </section>
  );
}

function WelcomeLine({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-start gap-2.5 border-b border-white/[0.07] py-3">
      <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#9cafb8]" />
      <p className="m-0 leading-relaxed">{children}</p>
    </div>
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
    <div className="flex gap-3 border-b border-white/[0.07] py-3.5">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-white/[0.045] text-white/64 [&_svg]:h-4 [&_svg]:w-4">
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <h3 className="m-0 text-sm font-semibold">{title}</h3>
          {done && <CheckCircle2 className="h-3.5 w-3.5 text-[#9cafb8]" />}
        </div>
        <p className="mt-1 mb-2 text-xs leading-relaxed text-white/50">{description}</p>
        {action}
      </div>
    </div>
  );
}
