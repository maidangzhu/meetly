export type TermDraft = {
  term: string;
  explanation: string;
};

export type ExplainedTerm = {
  id: string;
  term: string;
  explanation: string;
  normalized: string;
};

export const normalizeTerm = (term: string) =>
  term.trim().toLocaleLowerCase().replace(/[\s.．·\-_/+]/g, "");

export const recordDetectedTerms = (existing: ExplainedTerm[], incoming: TermDraft[]) => {
  const seen = new Set(existing.map((item) => item.normalized));
  const next = [...existing];

  for (const item of incoming) {
    const term = item.term.trim();
    const explanation = item.explanation.trim();
    const normalized = normalizeTerm(term);
    if (!term || !explanation || !normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    next.push({
      id: `${normalized}-${next.length + 1}`,
      term,
      explanation,
      normalized,
    });
  }

  return next;
};

export const heroTerm = (terms: ExplainedTerm[]) =>
  terms.length === 0 ? null : terms[terms.length - 1];

export const earlierTerms = (terms: ExplainedTerm[]) => terms.slice(0, -1).reverse();
