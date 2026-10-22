import { createHash } from "node:crypto";

/**
 * Cheap token estimate (~4 characters per token for English prose).
 * Chunk sizing only needs to be proportional, not exact; the real provider
 * reports billed tokens separately.
 */
export function estimateTokens(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return Math.max(1, Math.round(trimmed.length / 4));
}

export function sha256(input: string | Uint8Array): string {
  return createHash("sha256").update(input).digest("hex");
}

const ABBREVIATIONS = /\b(?:e\.g|i\.e|etc|vs|Mr|Mrs|Ms|Dr|No|Inc|Ltd|approx)\.$/i;

/**
 * Sentence splitter that keeps abbreviations, decimals ("99.95%") and version
 * numbers intact. Good enough for chunk boundaries; not a linguistic parser.
 */
export function splitSentences(text: string): string[] {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) return [];
  const parts: string[] = [];
  let start = 0;
  const boundary = /[.!?]["')\]]?\s+(?=["'(\[]?[A-Z0-9])/g;
  let match: RegExpExecArray | null;
  while ((match = boundary.exec(normalized)) !== null) {
    const end = match.index + match[0].trimEnd().length;
    const candidate = normalized.slice(start, end);
    if (ABBREVIATIONS.test(candidate)) continue;
    parts.push(candidate.trim());
    start = match.index + match[0].length;
  }
  const tail = normalized.slice(start).trim();
  if (tail) parts.push(tail);
  return parts;
}

/**
 * Name-based UUID (RFC 9562 v8 layout) derived from a sha256 digest. Chunk ids
 * built this way are stable across re-ingestion and across environments, which
 * makes rankings — including tie-breaks — reproducible.
 */
export function uuidFromString(input: string): string {
  const hex = sha256(input).slice(0, 32).split("");
  hex[12] = "8";
  hex[16] = ((Number.parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
  const h = hex.join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}
