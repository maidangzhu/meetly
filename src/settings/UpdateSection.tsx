import { relaunch } from "@tauri-apps/plugin-process";
import { check } from "@tauri-apps/plugin-updater";
import { useCallback, useState } from "react";

const PRIMARY_BUTTON = "ui-primary-button";
const SECONDARY_BUTTON = "ui-secondary-button";

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

  return (
    <section className="settings-section">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h2 className="section-title">Updates</h2>
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
