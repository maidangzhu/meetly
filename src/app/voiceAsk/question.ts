const VOICE_FILLERS = new Set([
  "嗯",
  "啊",
  "呃",
  "额",
  "哦",
  "好",
  "好的",
  "对",
  "是",
  "今天",
  "最近",
  "现在",
  "yes",
  "yeah",
  "yep",
  "ok",
  "okay",
]);

export function isMeaningfulVoiceQuestion(question: string) {
  const normalized = question
    .trim()
    .toLocaleLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, "");

  return normalized.length > 0 && !VOICE_FILLERS.has(normalized);
}
