import type { NewOrdinance, OrdinanceRelation } from "../db/schema";
import { decodeEntities } from "./html";

/** The JSON the Base de Normas returns for one ordinance (only the fields we use). */
export interface SourceRecord {
  id: number;
  nro: string;
  fec_sancion: string | null;
  fec_promulga: string | null;
  fec_publica: string | null;
  contenido: string | null;
  alcance: string | null;
  caracter: string | null;
  abrogacion_a: string | null;
  abrogacion_n: string | null;
  fec_excluido: string | null;
  url_html: string | null;
  url_pdf: string | null;
  url_actualizado_html: string | null;
}

const RELATION_KINDS: Record<string, OrdinanceRelation["kind"]> = {
  "abroga": "abroga",
  "abrogada por": "abrogada_por",
  "deroga": "deroga",
  "derogada por": "derogada_por",
  "modifica": "modifica",
  "modificada por": "modificada_por",
};

const withoutQuery = (url: string | null) => (url ? url.replace(/\?.*$/, "") : null);
const isoDate = (value: string | null) => (value && /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : null);
const clean = (html: string) => decodeEntities(html.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();

/** Descriptors and relations out of the ordinance's page in the Base de Normas. */
export function parseRecordPage(html: string): { descriptors: string[]; relations: OrdinanceRelation[] } {
  const descriptors: string[] = [];
  const descBlock = /Descriptores:\s*<\/strong>([\s\S]*?)<\/p>/i.exec(html)?.[1] ?? "";
  for (const m of descBlock.matchAll(/<a[^>]*search\/simple[^>]*>([\s\S]*?)<\/a>/gi)) {
    const tag = clean(m[1]);
    if (tag) descriptors.push(tag);
  }

  const relations: OrdinanceRelation[] = [];
  for (const li of html.matchAll(/<li>\s*<strong[^>]*>([^<]+?):?\s*<\/strong>([\s\S]*?)<\/li>/gi)) {
    const label = clean(li[1]).replace(/:$/, "");
    const kind = RELATION_KINDS[label.toLowerCase()] ?? "otra";
    const body = li[2];
    const act = /<a[^>]*\/normas\/show\/[^>]*>([\s\S]*?)<\/a>/i.exec(body);
    // Acts the database lists without a page come as plain text.
    const actText = act ? clean(act[1]) : clean(body.split(/<a/i)[0]);
    if (!actText) continue;
    let detail: string | null = null;
    if (act) {
      const after = body.slice((act.index ?? 0) + act[0].length).split(/<a/i)[0];
      detail = clean(after) || null;
    }
    const ordinance = /^ORDENANZA MUNICIPAL\s+(\d+)/i.exec(actText);
    relations.push({ kind, label, act: actText, ordinance: ordinance ? Number(ordinance[1]) : null, detail });
  }
  return { descriptors, relations };
}

/** Database row for one ordinance, from its JSON record and (optionally) its page. */
export function toOrdinanceRow(
  record: SourceRecord,
  page: { descriptors: string[]; relations: OrdinanceRelation[] } | null,
  text: { source: "actualizado" | "original"; url: string } | null,
): NewOrdinance {
  const repealed = record.abrogacion_n && /^\d+$/.test(record.abrogacion_n.trim()) ? Number(record.abrogacion_n) : null;
  return {
    number: Number(record.nro),
    sourceId: record.id,
    sanctionedOn: isoDate(record.fec_sancion),
    promulgatedOn: isoDate(record.fec_promulga),
    publishedOn: isoDate(record.fec_publica),
    summary: (record.contenido ?? "").trim(),
    scope: record.alcance || null,
    character: record.caracter || null,
    inForce: !record.abrogacion_n && !record.fec_excluido,
    repealedBy: repealed,
    excludedOn: isoDate(record.fec_excluido),
    descriptors: page?.descriptors ?? [],
    relations: page?.relations ?? [],
    textSource: text?.source ?? null,
    textUrl: text?.url ?? null,
    originalUrl: withoutQuery(record.url_html),
    pdfUrl: withoutQuery(record.url_pdf),
  };
}
