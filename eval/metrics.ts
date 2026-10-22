import { fold } from "@/server/text/terms";
import type { ExpectedItem, GoldenQuestion } from "./dataset";

export interface ChunkRef {
  ordinanceNumber: number;
  content: string;
}

const normalize = (s: string) => fold(s).replace(/\s+/g, " ").trim();

/** A chunk satisfies an expected item when it belongs to that ordinance and contains one of its evidence strings. */
export function matchesItem(chunk: ChunkRef, item: ExpectedItem): boolean {
  if (chunk.ordinanceNumber !== item.ordinance) return false;
  if (!item.evidence.length) return true;
  const text = normalize(chunk.content);
  return item.evidence.some((e) => text.includes(normalize(e)));
}

export function isRelevant(chunk: ChunkRef, question: GoldenQuestion): boolean {
  return question.expected.some((item) => matchesItem(chunk, item));
}

/** Recall@k: with match="any", 1 if any expected item is in the top k; with "all", the fraction found. */
export function recallAtK(ranked: ChunkRef[], question: GoldenQuestion, k: number): number {
  if (question.expected.length === 0) return 1;
  const top = ranked.slice(0, k);
  const found = question.expected.filter((item) => top.some((c) => matchesItem(c, item))).length;
  return question.match === "any" ? (found > 0 ? 1 : 0) : found / question.expected.length;
}

/** Reciprocal rank of the first relevant chunk (0 if none in the list). */
export function reciprocalRank(ranked: ChunkRef[], question: GoldenQuestion): number {
  const index = ranked.findIndex((c) => isRelevant(c, question));
  return index === -1 ? 0 : 1 / (index + 1);
}

/** Fraction of cited chunks that are relevant. Null when nothing was cited. */
export function citationPrecision(cited: ChunkRef[], question: GoldenQuestion): number | null {
  if (cited.length === 0) return null;
  return cited.filter((c) => isRelevant(c, question)).length / cited.length;
}

/** The answer contains every key fact. */
export function containsKeyFacts(answer: string, mustInclude: string[]): boolean {
  const text = normalize(answer);
  return mustInclude.every((fact) => text.includes(normalize(fact)));
}

/** Ordinance numbers an answer names ("Ordenanza 4471", "la 15.043", "O-26500"). */
export function namedOrdinances(text: string): number[] {
  const found = new Set<number>();
  for (const m of text.matchAll(/\b(?:ordenanzas?|ord\.?|o\s*-)\s*(?:n(?:[º°o.]|ro\.?|[uú]mero)?\s*)?(\d{1,2}\.\d{3}|\d{3,5})\b/gi)) {
    found.add(Number(m[1].replace(".", "")));
  }
  return [...found];
}

export function mean(values: number[]): number | null {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
}
