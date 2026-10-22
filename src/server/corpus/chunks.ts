import type { NewOrdinance, OrdinanceRelation } from "../db/schema";
import { estimateTokens, sha256, splitSentences, uuidFromString } from "../ingest/text";
import type { Segmented, Unit } from "./segment";

export interface CorpusChunk {
  id: string;
  ordinanceNumber: number;
  ordinal: number;
  kind: "record" | "article" | "annex" | "text";
  label: string | null;
  content: string;
  headingPath: string;
  context: string;
  tokenCount: number;
  contentHash: string;
}

/** Articles longer than this are split; the parts keep the article's label. */
const MAX_TOKENS = 450;
const TARGET_TOKENS = 320;
/** Loose text shorter than this ("TAXIS", a lone signature) is not worth a chunk. */
const MIN_TEXT_CHARS = 40;

const DATE = new Intl.DateTimeFormat("es-AR", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" });
export function formatDate(iso: string | null | undefined): string | null {
  return iso ? DATE.format(new Date(`${iso}T00:00:00Z`)) : null;
}

/** Modifications the Base de Normas lists that are newer than what the consolidated text incorporates. */
export function laterAmendments(ordinance: Pick<NewOrdinance, "relations" | "textSource">, segmented: Segmented | null): number[] {
  const relations = (ordinance.relations ?? []) as OrdinanceRelation[];
  const amending = relations
    .filter((r) => (r.kind === "modificada_por" || r.kind === "derogada_por") && r.ordinance !== null)
    .map((r) => r.ordinance!);
  if (ordinance.textSource === "original") return [...new Set(amending)].sort((a, b) => a - b);
  const incorporated = segmented?.header.amendedBy ?? [];
  if (!incorporated.length) return [];
  const newest = Math.max(...incorporated);
  return [...new Set(amending.filter((n) => n > newest && !incorporated.includes(n)))].sort((a, b) => a - b);
}

function listNumbers(numbers: number[], max = 12): string {
  const sorted = [...numbers].sort((a, b) => a - b);
  if (sorted.length <= max) return sorted.length > 1 ? `${sorted.slice(0, -1).join(", ")} y ${sorted.at(-1)}` : String(sorted[0]);
  return `${sorted.slice(0, max).join(", ")} y ${sorted.length - max} más`;
}

/** "las ordenanzas 4534 y 6089" / "la Ordenanza 27004". */
function ordinancesPhrase(numbers: number[]): string {
  return numbers.length === 1 ? `la Ordenanza ${numbers[0]}` : `las ordenanzas ${listNumbers(numbers)}`;
}

/** The "record" chunk: what the ordinance is about, its dates, topics and status, in one paragraph. */
export function recordContent(o: NewOrdinance, later: number[]): string {
  const relations = (o.relations ?? []) as OrdinanceRelation[];
  const modifiedBy = [...new Set(relations.filter((r) => r.kind === "modificada_por" && r.ordinance).map((r) => r.ordinance!))];
  const modifies = [...new Set(relations.filter((r) => (r.kind === "modifica" || r.kind === "deroga" || r.kind === "abroga") && r.ordinance).map((r) => r.ordinance!))];
  const parts = [
    `Ordenanza ${o.number}${o.sanctionedOn ? `, sancionada el ${formatDate(o.sanctionedOn)}` : ""}.`,
    o.summary ? o.summary.replace(/\s*\.?$/, ".") : null,
    o.descriptors?.length ? `Temas: ${o.descriptors.join(", ").toLowerCase()}.` : null,
    o.inForce ? "Estado: vigente." : `Estado: no vigente${o.repealedBy ? ` (abrogada por la Ordenanza ${o.repealedBy})` : ""}.`,
    modifiedBy.length ? `Modificada por ${ordinancesPhrase(modifiedBy)}.` : null,
    modifies.length ? `Modifica o deroga normas anteriores: ${ordinancesPhrase(modifies)}.` : null,
    later.length && o.textSource === "actualizado"
      ? `El texto actualizado publicado no incorpora todavía ${ordinancesPhrase(later)}.`
      : null,
  ];
  return parts.filter(Boolean).join(" ");
}

function splitLong(text: string): string[] {
  if (estimateTokens(text) <= MAX_TOKENS) return [text];
  const pieces: string[] = [];
  const lines = text.split("\n").flatMap((l) => (estimateTokens(l) > TARGET_TOKENS ? splitSentences(l) : [l]));
  let buffer: string[] = [];
  let tokens = 0;
  for (const line of lines) {
    const t = estimateTokens(line);
    if (buffer.length && tokens + t > TARGET_TOKENS) {
      pieces.push(buffer.join("\n"));
      buffer = [];
      tokens = 0;
    }
    buffer.push(line);
    tokens += t;
  }
  if (buffer.length) pieces.push(buffer.join("\n"));
  return pieces;
}

/** Chunks for one ordinance: its record card first, then every article (or part of one) and annex block. */
export function buildChunks(o: NewOrdinance, segmented: Segmented | null): CorpusChunk[] {
  const number = o.number;
  const context = `Ordenanza ${number}: ${o.summary ?? ""}`.trim();
  const out: CorpusChunk[] = [];
  const push = (kind: CorpusChunk["kind"], label: string | null, headingPath: string, content: string) => {
    const ordinal = out.length;
    const contentHash = sha256(`${headingPath}\n${label ?? ""}\n${content}`);
    out.push({
      id: uuidFromString(`${number}:${ordinal}:${contentHash}`),
      ordinanceNumber: number,
      ordinal,
      kind,
      label,
      content,
      headingPath,
      context,
      tokenCount: estimateTokens(content),
      contentHash,
    });
  };

  push("record", "Ficha", "", recordContent(o, laterAmendments(o, segmented)));

  for (const unit of segmented?.units ?? []) {
    if (!keepUnit(unit)) continue;
    const parts = splitLong(unit.text);
    parts.forEach((part, i) => {
      const label = unit.label && parts.length > 1 ? `${unit.label} (parte ${i + 1} de ${parts.length})` : unit.label;
      push(unit.kind, label, unit.headings.join(" > "), part);
    });
  }
  return out;
}

function keepUnit(unit: Unit): boolean {
  const body = unit.kind === "article" ? unit.text.replace(/^[^\n]*?[º°o]?\s*[.\-:–—]+\s*/, "") : unit.text;
  return body.trim().length >= (unit.kind === "article" ? 15 : MIN_TEXT_CHARS);
}

/** What gets embedded: the ordinance, where in it, and the text. */
export function corpusEmbeddingInput(chunk: Pick<CorpusChunk, "context" | "headingPath" | "label" | "content" | "kind">): string {
  if (chunk.kind === "record") return chunk.content;
  const where = [chunk.headingPath, chunk.label].filter(Boolean).join(" — ");
  return `${chunk.context}${where ? `\n${where}` : ""}\n\n${chunk.content}`;
}
