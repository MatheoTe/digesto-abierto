/**
 * Browser-safe helpers that locate the sentence of a passage that supports a
 * given claim, so citation popovers and the source panel can highlight it.
 */
const STOP = new Set(
  "a an and are as at be by for from has have how in is it its of on or that the their this to was were what when which who will with you your".split(
    " ",
  ),
);

export function lexicalTerms(text: string): Set<string> {
  const tokens = text.toLowerCase().match(/[a-z0-9]+(?:[-.][a-z0-9]+)*/g) ?? [];
  return new Set(tokens.filter((t) => t.length > 1 && !STOP.has(t)).map((t) => t.replace(/(ies|es|s)$/, "")));
}

export interface Range {
  start: number;
  end: number;
}

/** Sentence ranges (character offsets) inside `text`, splitting on terminal punctuation and line breaks. */
export function sentenceRanges(text: string): Range[] {
  const ranges: Range[] = [];
  const re = /[^.!?\n]+(?:[.!?]+(?=\s|$)|(?=\n)|$)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (!m[0].trim()) {
      if (re.lastIndex === m.index) re.lastIndex++;
      continue;
    }
    const lead = m[0].length - m[0].trimStart().length;
    ranges.push({ start: m.index + lead, end: m.index + m[0].trimEnd().length });
  }
  return ranges;
}

/** Best-supporting sentence for `claim` inside `content`, or null if nothing overlaps. */
export function bestSupportingRange(content: string, claim: string): Range | null {
  const cleaned = claim.replace(/\s*\[[\d,;\s–-]+\]/g, "").replace(/^[-*•\s]+/, "").trim();
  if (!cleaned) return null;
  const exact = content.indexOf(cleaned.replace(/[.\s]+$/, ""));
  if (exact >= 0) return { start: exact, end: exact + cleaned.replace(/[.\s]+$/, "").length };

  const claimTerms = lexicalTerms(cleaned);
  if (claimTerms.size === 0) return null;
  let best: { range: Range; score: number } | null = null;
  for (const range of sentenceRanges(content)) {
    const terms = lexicalTerms(content.slice(range.start, range.end));
    let overlap = 0;
    for (const t of claimTerms) if (terms.has(t)) overlap++;
    const score = overlap / claimTerms.size;
    if (overlap > 0 && (!best || score > best.score)) best = { range, score };
  }
  return best && best.score >= 0.25 ? best.range : null;
}
