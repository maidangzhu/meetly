export function AudioBars({ level }: { level: number }) {
  const normalized = Math.max(0, Math.min(1, level));

  return (
    <div className="flex h-[26px] w-[116px] shrink-0 items-center gap-1 overflow-hidden" aria-hidden="true">
      {Array.from({ length: 18 }).map((_, index) => (
        <span
          key={index}
          className="w-[3px] rounded-full bg-white/70 transition-[height,opacity] duration-75"
          style={{
            height: `${4 + Math.min(22, normalized * 30 * (0.45 + ((index % 6) + 1) / 9))}px`,
            opacity: 0.35 + normalized * 0.6,
          }}
        />
      ))}
    </div>
  );
}
