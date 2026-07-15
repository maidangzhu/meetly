export const CARD_SURFACE =
  "border border-white/[0.09] bg-[rgb(19_21_22_/_0.94)] shadow-[0_14px_36px_rgb(0_0_0_/_0.24)] backdrop-blur-[22px]";
export const ICON_BUTTON =
  "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border-0 bg-white/[0.06] text-[#f5f5f5] transition-[background,color,transform] duration-150 hover:bg-white/[0.11] active:scale-[0.98] [&_svg]:h-4 [&_svg]:w-4";
export const SESSION_BUTTON =
  "inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-lg border-0 bg-white/[0.06] px-2.5 text-[13px] font-medium text-[#f5f5f5] transition-[background,color,transform] duration-150 hover:bg-white/[0.11] active:scale-[0.98] [&_svg]:h-4 [&_svg]:w-4";
export const GHOST_ICON_BUTTON =
  "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border-0 bg-transparent text-white/52 transition-[background,color,transform] duration-150 hover:bg-white/[0.09] hover:text-white/80 active:scale-[0.98] [&_svg]:h-4 [&_svg]:w-4";
export const DRAG_CURSOR = "cursor-grab active:cursor-grabbing";

export const MIC_SEGMENT_MS = 4_000;
export const MIC_MIN_SEGMENT_MS = 1_200;
export const MIC_VAD_INTERVAL_MS = 100;
export const MIC_VAD_SILENCE_MS = 1_100;
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
