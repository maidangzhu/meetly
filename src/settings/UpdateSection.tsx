import { relaunch } from "@tauri-apps/plugin-process";
import { check } from "@tauri-apps/plugin-updater";
import { useCallback, useEffect, useState } from "react";

const PRIMARY_BUTTON =
  "rounded-lg bg-white/90 px-3 py-2 text-sm font-medium text-black transition-[background,transform] duration-150 hover:bg-white active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50";
const SECONDARY_BUTTON =
  "rounded-lg border border-white/15 bg-white/[0.06] px-3 py-2 text-sm text-white/80 transition-[background,transform] duration-150 hover:bg-white/[0.12] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50";

export function UpdateSection() {
  const [isChecking, setIsChecking] = useState(false);
  const [isInstalling, setIsInstalling] = useState(false);
  const [message, setMessage] = useState("未检查更新。");
  const [availableVersion, setAvailableVersion] = useState<string | null>(null);

  const checkForUpdates = useCallback(async (silent = false) => {
    setIsChecking(true);
    if (!silent) {
      setMessage("正在检查更新...");
    }

    try {
      const update = await check();
      if (!update) {
        setAvailableVersion(null);
        setMessage("当前已经是最新版本。");
        return;
      }

      setAvailableVersion(update.version);
      setMessage(`发现新版本 ${update.version}。`);
    } catch (error) {
      const nextMessage = error instanceof Error ? error.message : String(error);
      setMessage(`检查更新失败：${nextMessage}`);
    } finally {
      setIsChecking(false);
    }
  }, []);

  const installUpdate = useCallback(async () => {
    setIsInstalling(true);
    setMessage("正在下载并安装更新...");

    try {
      const update = await check();
      if (!update) {
        setAvailableVersion(null);
        setMessage("当前已经是最新版本。");
        return;
      }

      await update.downloadAndInstall();
      setMessage("更新已安装，正在重启 Meetly...");
      await relaunch();
    } catch (error) {
      const nextMessage = error instanceof Error ? error.message : String(error);
      setMessage(`安装更新失败：${nextMessage}`);
    } finally {
      setIsInstalling(false);
    }
  }, []);

  useEffect(() => {
    void checkForUpdates(true);
  }, [checkForUpdates]);

  return (
    <section className="mb-6 rounded-xl border border-white/[0.08] bg-white/[0.04] p-4">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h2 className="m-0 text-sm font-semibold">Updates</h2>
          <p className="mt-1 mb-0 text-xs text-white/50">
            从 GitHub Release 检查已签名的新版本。
          </p>
        </div>
        <button
          className={SECONDARY_BUTTON}
          disabled={isChecking || isInstalling}
          onClick={() => void checkForUpdates(false)}
        >
          {isChecking ? "Checking..." : "Check"}
        </button>
      </div>

      <p className="m-0 mb-3 text-xs leading-relaxed text-white/58">{message}</p>
      {availableVersion && (
        <button className={PRIMARY_BUTTON} disabled={isInstalling} onClick={() => void installUpdate()}>
          {isInstalling ? "Installing..." : `Install ${availableVersion}`}
        </button>
      )}
    </section>
  );
}
