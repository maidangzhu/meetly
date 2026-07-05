export const CARD_SURFACE =
  "border border-white/10 bg-[rgb(27_27_28_/_0.82)] shadow-[0_8px_24px_rgb(0_0_0_/_0.16)] backdrop-blur-[20px]";
export const ICON_BUTTON =
  "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border-0 bg-white/[0.08] text-[#f5f5f5] transition-[background,color,transform] duration-150 hover:bg-white/[0.14] active:scale-[0.98] [&_svg]:h-4 [&_svg]:w-4";
export const SESSION_BUTTON =
  "inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-xl border-0 bg-white/[0.08] px-2.5 text-[13px] font-medium text-[#f5f5f5] transition-[background,color,transform] duration-150 hover:bg-white/[0.14] active:scale-[0.98] [&_svg]:h-4 [&_svg]:w-4";
export const STEALTH_STATUS_BUTTON =
  "inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-xl border-0 bg-white/[0.08] px-2.5 text-[12px] font-medium text-[#f5f5f5] transition-[background,color,transform] duration-150 hover:bg-white/[0.14] active:scale-[0.98] [&_svg]:h-4 [&_svg]:w-4";
export const GHOST_ICON_BUTTON =
  "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border-0 bg-transparent text-white/60 transition-[background,color,transform] duration-150 hover:bg-white/[0.14] active:scale-[0.98] [&_svg]:h-4 [&_svg]:w-4";
export const DRAG_CURSOR = "cursor-grab active:cursor-grabbing";

export const MIC_SEGMENT_MS = 2_000;
export const MIC_MIN_SEGMENT_MS = 900;
export const MIC_VAD_INTERVAL_MS = 100;
export const MIC_VAD_SILENCE_MS = 650;
export const MIC_VAD_RMS_THRESHOLD = 0.018;
export const FULL_SESSION_SEGMENT_LIMIT = 500;
export const AUTO_ASSIST_MIN_CONFIDENCE = 0.68;
export const AUTO_ASSIST_PREFETCH_CONFIDENCE = 0.88;
export const AUTO_ASSIST_HINT_TTL_MS = 16_000;
export const AUTO_ASSIST_HINT_COOLDOWN_MS = 10_000;
export const AUTO_ASSIST_DEDUPE_WINDOW_MS = 45_000;
export const AUTO_ASSIST_CACHE_TTL_MS = 30_000;
export const AUTO_ASSIST_PREFETCH_ENABLED = true;
export const COACH_HEARTBEAT_MS = 10_000;
export const COACH_MAX_MESSAGES = 8;
