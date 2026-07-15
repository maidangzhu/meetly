type AudioBarsProps = {
  level: number;
  active?: boolean;
  tone?: "cool" | "warm";
  variant?: "island" | "compact";
};

const COMPACT_SHAPE = [0.28, 0.44, 0.64, 0.84, 1, 0.84, 0.64, 0.44, 0.28];
const ISLAND_SHAPE = [0.24, 0.36, 0.52, 0.72, 0.9, 1, 0.9, 0.72, 0.52, 0.36, 0.24];

export function AudioBars({
  level,
  active = true,
  tone = "cool",
  variant = "island",
}: AudioBarsProps) {
  const normalized = active ? Math.max(0.08, Math.min(1, level)) : 0;
  const isCompact = variant === "compact";
  const shape = isCompact ? COMPACT_SHAPE : ISLAND_SHAPE;
  const maxHeight = isCompact ? 18 : 20;

  return (
    <div
      className={`voice-waveform voice-waveform--${variant} voice-waveform--${tone}`}
      aria-hidden="true"
    >
      {shape.map((weight, index) => (
        <span
          key={index}
          className="voice-waveform__bar"
          style={{
            height: `${2 + normalized * weight * maxHeight}px`,
            opacity: active ? 0.38 + normalized * 0.54 : 0.22,
          }}
        />
      ))}
    </div>
  );
}
