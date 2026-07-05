import { invoke } from "@tauri-apps/api/core";

export const isTauriRuntime = () => "__TAURI_INTERNALS__" in window;

export async function safeInvoke<T>(command: string, args?: Record<string, unknown>) {
  if (!isTauriRuntime()) {
    return undefined as T;
  }

  return invoke<T>(command, args);
}

export function debugLog(message: string) {
  void safeInvoke("append_debug_log", { message }).catch((error) => {
    console.error("Failed to write debug log:", error);
  });
}

export function createId(prefix: string) {
  return `${prefix}-${Date.now().toString(16)}-${Math.random().toString(16).slice(2, 8)}`;
}

export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = reader.result;
      if (typeof result === "string") {
        resolve(result);
        return;
      }
      reject(new Error("Failed to read audio blob as base64."));
    };
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read audio blob."));
    reader.readAsDataURL(blob);
  });
}

export function calculateRms(data: Uint8Array) {
  if (data.length === 0) {
    return 0;
  }

  let sum = 0;
  for (const value of data) {
    const normalized = (value - 128) / 128;
    sum += normalized * normalized;
  }

  return Math.sqrt(sum / data.length);
}
