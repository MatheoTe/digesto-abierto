/**
 * Citation protocol shared by the server (validation, eval metrics) and the
 * browser (rendering). The model cites numbered sources inline as `[1]`,
 * `[1, 3]` or `[2-4]`; anything else in square brackets is plain text.
 */
export const ABSTAIN_ANSWER = "No encontré esto en las ordenanzas vigentes del digesto.";

const MARKER = /\[(\s*\d{1,3}\s*(?:(?:[,;]|-|–)\s*\d{1,3}\s*)*)\]/g;

export type AnswerSegment = { type: "text"; text: string } | { type: "cite"; indices: number[] };

function expand(body: string): number[] {
  const out: number[] = [];
  for (const part of body.split(/[,;]/)) {
    const range = part.split(/-|–/).map((n) => Number.parseInt(n.trim(), 10));
    if (range.length === 2 && range[0] <= range[1] && range[1] - range[0] <= 20) {
      for (let i = range[0]; i <= range[1]; i++) out.push(i);
    } else {
      out.push(...range.filter((n) => Number.isFinite(n)));
    }
  }
  return out;
}

/**
 * Split an answer into text and citation segments. Markers referencing a
 * source that does not exist are left as literal text so a hallucinated
 * "[7]" can never render as a clickable citation.
 */
export function segmentAnswer(text: string, sourceCount: number): AnswerSegment[] {
  const segments: AnswerSegment[] = [];
  let last = 0;
  for (const match of text.matchAll(MARKER)) {
    const indices = expand(match[1]);
    const valid = indices.length > 0 && indices.every((i) => i >= 1 && i <= sourceCount);
    if (!valid) continue;
    if (match.index > last) segments.push({ type: "text", text: text.slice(last, match.index) });
    segments.push({ type: "cite", indices: [...new Set(indices)] });
    last = match.index + match[0].length;
  }
  if (last < text.length) segments.push({ type: "text", text: text.slice(last) });
  return segments;
}

export interface CitationExtraction {
  /** Valid source indices in order of first appearance. */
  cited: number[];
  /** Indices the model referenced that were not in the provided sources. */
  invalid: number[];
}

export function extractCitations(text: string, sourceCount: number): CitationExtraction {
  const cited: number[] = [];
  const invalid: number[] = [];
  for (const match of text.matchAll(MARKER)) {
    for (const i of expand(match[1])) {
      const bucket = i >= 1 && i <= sourceCount ? cited : invalid;
      if (!bucket.includes(i)) bucket.push(i);
    }
  }
  return { cited, invalid };
}

export function isAbstention(text: string): boolean {
  const normalized = text.trim().toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "");
  return normalized.startsWith("no encontre esto en las ordenanzas");
}

export interface CitationMarkdown {
  /** Markdown where every valid marker became a link `[n](#cite-n-k)` (k = occurrence). */
  markdown: string;
  /** The claim each occurrence supports: the sentence the marker closes. */
  claims: string[];
}

/** Last sentence of `text` (the claim a trailing citation marker refers to). */
function trailingSentence(text: string): string {
  const trimmed = text.replace(/\s+$/, "");
  const lineStart = trimmed.lastIndexOf("\n") + 1;
  const line = trimmed.slice(lineStart);
  const body = line.replace(/[.!?]+$/, "");
  const boundary = Math.max(body.lastIndexOf(". "), body.lastIndexOf("! "), body.lastIndexOf("? "));
  return line.slice(boundary >= 0 ? boundary + 2 : 0).replace(/^[-*•\s]+/, "").trim();
}

/**
 * Prepare a (possibly still streaming) answer for markdown rendering: valid
 * citation markers become in-document links the renderer turns into pills,
 * and each occurrence remembers the claim it supports for highlighting.
 */
export function toCitationMarkdown(text: string, sourceCount: number): CitationMarkdown {
  const claims: string[] = [];
  let markdown = "";
  let textSoFar = "";
  for (const segment of segmentAnswer(text, sourceCount)) {
    if (segment.type === "text") {
      markdown += segment.text;
      textSoFar += segment.text;
      continue;
    }
    const claim = trailingSentence(textSoFar);
    markdown += segment.indices
      .map((index) => {
        claims.push(claim);
        return `[${index}](#cite-${index}-${claims.length - 1})`;
      })
      .join("");
  }
  return { markdown, claims };
}

/** Plain-text version for the clipboard: markers kept, sources listed at the end. */
export function answerForClipboard(
  answer: string,
  sources: { index: number; ordinanceNumber: number; label: string | null; kind: string; textUrl: string | null }[],
  cited: number[],
): string {
  const list = sources
    .filter((s) => cited.includes(s.index))
    .map((s) => `[${s.index}] Ordenanza ${s.ordinanceNumber}${s.label && s.kind !== "record" ? `, ${s.label}` : ""}${s.textUrl ? ` — ${s.textUrl}` : ""}`);
  return list.length ? `${answer.trim()}\n\nFuentes:\n${list.join("\n")}` : answer.trim();
}
