import type { ExplainedTerm } from "../app/terms";

type TermCardProps = {
  earlier: ExplainedTerm[];
  hero: ExplainedTerm;
  industry: string;
};

export function TermCard({ earlier, hero, industry }: TermCardProps) {
  return (
    <section
      className="flex h-full min-h-0 flex-col rounded-lg border border-white/[0.09] bg-[rgb(12_13_14_/_0.94)] px-6 py-5 text-white shadow-[0_18px_48px_rgb(0_0_0_/_0.38)]"
      aria-label="术语解释"
    >
      <p className="m-0 text-sm text-white/46">{industry}</p>
      <h1 className="m-0 mt-3 break-words text-[64px] font-semibold leading-none tracking-tight text-white">{hero.term}</h1>
      <p className="m-0 mt-4 text-[28px] leading-snug text-white/90">{hero.explanation}</p>
      {earlier.length > 0 && (
        <ul className="mt-5 min-h-0 flex-1 space-y-1 overflow-y-auto border-t border-white/10 pt-3" aria-label="本场已解释的术语">
          {earlier.map(renderEarlierTerm)}
        </ul>
      )}
    </section>
  );
}

const renderEarlierTerm = (term: ExplainedTerm) => (
  <li key={term.id} className="flex items-baseline gap-3 py-1">
    <span className="shrink-0 text-sm font-medium text-white/80">{term.term}</span>
    <span className="min-w-0 truncate text-sm text-white/46">{term.explanation}</span>
  </li>
);
