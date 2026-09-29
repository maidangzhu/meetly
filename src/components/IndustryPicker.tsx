import { CUSTOM_INDUSTRY_ID, INDUSTRY_HINT, INDUSTRY_PRESETS, type IndustryChoice } from "../app/industry";

const presetClassName = (selected: boolean) =>
  selected
    ? "border-[#d7b09a] bg-[#c17f59]/18 text-white"
    : "border-white/10 bg-white/[0.03] text-white/72 hover:bg-white/[0.06]";

type IndustryPickerProps = {
  choice: IndustryChoice;
  onChange: (choice: IndustryChoice) => void;
};

export function IndustryPicker({ choice, onChange }: IndustryPickerProps) {
  const customSelected = choice.presetId === CUSTOM_INDUSTRY_ID;

  const handleSelectPreset = (presetId: string) => {
    onChange({ ...choice, presetId });
  };

  const handleCustomText = (customText: string) => {
    onChange({ presetId: CUSTOM_INDUSTRY_ID, customText });
  };

  return (
    <div>
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="行业">
        {INDUSTRY_PRESETS.map((preset) => renderPreset(preset.id, preset.label, choice.presetId === preset.id, handleSelectPreset))}
        {renderPreset(CUSTOM_INDUSTRY_ID, "其他", customSelected, handleSelectPreset)}
      </div>
      {customSelected && (
        <label className="mt-3 block">
          <span className="mb-1 block text-xs text-white/48">自定义行业</span>
          <input
            className="ui-field"
            value={choice.customText}
            placeholder="例如：法律、能源"
            aria-label="自定义行业"
            onChange={(event) => handleCustomText(event.target.value)}
          />
        </label>
      )}
      <p className="mt-3 mb-0 text-xs leading-relaxed text-white/42">{INDUSTRY_HINT}</p>
    </div>
  );
}

const renderPreset = (
  id: string,
  label: string,
  selected: boolean,
  onSelect: (presetId: string) => void,
) => (
  <button
    key={id}
    type="button"
    role="radio"
    aria-checked={selected}
    className={`rounded-full border px-3 py-1.5 text-sm transition-colors ${presetClassName(selected)}`}
    onClick={() => onSelect(id)}
  >
    {label}
  </button>
);
