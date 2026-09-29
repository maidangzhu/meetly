export const INDUSTRY_PRESETS = [
  { id: "cro", label: "CRO / 临床研究" },
  { id: "it", label: "IT" },
  { id: "architecture", label: "建筑" },
  { id: "commerce", label: "电商" },
  { id: "finance", label: "金融" },
  { id: "healthcare", label: "医疗" },
  { id: "manufacturing", label: "制造" },
  { id: "education", label: "教育" },
] as const;

export const CUSTOM_INDUSTRY_ID = "custom";

export const INDUSTRY_HINT =
  "同一个缩写会按你选的行业解释。在 CRO / 临床研究里，CTA 是临床试验助理；在电商里，CTA 可以是行动号召。两种意思都说得通时，不会弹出卡片。";

export type IndustryPresetId = (typeof INDUSTRY_PRESETS)[number]["id"];

export type IndustryChoice = {
  presetId: string;
  customText: string;
};

export const EMPTY_INDUSTRY_CHOICE: IndustryChoice = {
  presetId: "",
  customText: "",
};

const PRESET_IDS = new Set<string>(INDUSTRY_PRESETS.map((preset) => preset.id));

export const isKnownIndustryPreset = (presetId: string) =>
  presetId === CUSTOM_INDUSTRY_ID || PRESET_IDS.has(presetId);

export const resolveIndustryLabel = (choice: IndustryChoice) => {
  if (choice.presetId === CUSTOM_INDUSTRY_ID) {
    return choice.customText.trim();
  }
  return INDUSTRY_PRESETS.find((preset) => preset.id === choice.presetId)?.label ?? "";
};

export const isIndustryReady = (choice: IndustryChoice) => resolveIndustryLabel(choice).length > 0;

export const termRequestInput = (choice: IndustryChoice, transcript: string) => ({
  industry: resolveIndustryLabel(choice),
  transcript: transcript.trim(),
});
