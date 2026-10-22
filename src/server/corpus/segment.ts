/**
 * Splits the plain text of an ordinance into the units a citation can point
 * at: one per article, plus annex blocks. Headings (Título / Capítulo /
 * "III - DE LOS VEHICULOS" / Anexo) travel with every article under them, so
 * a chunk that only says "deberá renovarse cada dos años" still knows it is
 * the taxi licence chapter of Ordinance 4471.
 *
 * The "FUNDAMENTOS" (rationale) and the signatures after "Comuníquese" are not
 * normative text and are left out.
 */

export type UnitKind = "article" | "annex" | "text";

export interface Unit {
  kind: UnitKind;
  /** "Art. 4º", "Art. 15º bis", "Anexo I" — null for loose text. */
  label: string | null;
  headings: string[];
  text: string;
}

export interface Header {
  number: number | null;
  /** The file is the consolidated "texto actualizado". */
  consolidated: boolean;
  /** Ordinances the consolidated text says it incorporates. */
  amendedBy: number[];
  lines: string[];
}

export interface Segmented {
  header: Header;
  units: Unit[];
}

const ORDINANCE_LINE = /^ORDENANZA\s*N?\s*[º°o]?\s*\.?\s*:?\s*(\d{1,2}\.?\d{3}|\d{1,5})\b/i;
const ARTICLE = /^(?:art[íi]culo|art\.?)\s*(\d{1,3})\s*[º°o]?\s*((?:bis|ter|qu[aá]ter|quinquies|sexies)\b)?\s*(?:[\.\-:–—]+\s*)?/i;
const STRUCTURAL = /^(T[ÍI]TULO|CAP[ÍI]TULO|SECCI[ÓO]N|PARTE|LIBRO)\s+([IVXLCDM]+|\d+|[ÚU]NIC[OA]|PRIMER[OA]|SEGUND[OA]|TERCER[OA])\b/i;
const ROMAN_HEADING = /^([IVXLC]+)\s*[-–—.)]\s*\S/;
const ANNEX = /^ANEXO\s*([IVXLC]+|\d+|[ÚU]NICO|[A-Z])?\b/i;
const CLOSING = /^comun[íi]quese/i;
const RATIONALE = /^FUNDAMENTOS\b/i;

/** Short line in capitals with no sentence punctuation: a section title. */
function looksLikeCapsHeading(line: string): boolean {
  if (line.length < 4 || line.length > 90) return false;
  if (/[.;:]$/.test(line)) return false;
  const letters = line.replace(/[^A-Za-zÁÉÍÓÚÑÜáéíóúñü]/g, "");
  if (letters.length < 4) return false;
  const upper = letters.replace(/[^A-ZÁÉÍÓÚÑÜ]/g, "").length;
  return upper / letters.length > 0.85;
}

function articleLabel(match: RegExpExecArray): string {
  const suffix = match[2] ? ` ${match[2].toLowerCase()}` : "";
  return `Art. ${match[1]}º${suffix}`;
}

function parseHeader(lines: string[]): Header {
  let number: number | null = null;
  let consolidated = false;
  const amendedBy = new Set<number>();
  let inAmendments = false;
  for (const line of lines) {
    const m = ORDINANCE_LINE.exec(line);
    if (m && number === null) number = Number(m[1].replace(".", ""));
    if (/TEXTO\s+ACTUALIZADO/i.test(line)) consolidated = true;
    // "Modificada por Ordenanzas: 4534, 4887," often wraps onto lines that start with a number.
    if (/^modificad[ao]s?\s+por/i.test(line)) inAmendments = true;
    else if (!/^\d/.test(line)) inAmendments = false;
    if (inAmendments) {
      const list = line.replace(/\(.*$/, "");
      for (const n of list.match(/\b\d{1,2}\.?\d{3}\b/g) ?? []) amendedBy.add(Number(n.replace(".", "")));
    }
  }
  return { number, consolidated, amendedBy: [...amendedBy], lines };
}

export function segmentOrdinance(text: string): Segmented {
  const all = text.split("\n").map((l) => l.trim()).filter(Boolean);

  // The header runs up to (and includes) the "ORDENANZA Nº" line and the
  // "TEXTO ACTUALIZADO / Modificada por" lines right after it.
  let bodyStart = all.findIndex((l) => ORDINANCE_LINE.test(l));
  if (bodyStart === -1) bodyStart = 0;
  else {
    bodyStart += 1;
    // "TEXTO ACTUALIZADO", "Modificada por …" and its wrapped continuation lines (they start with a number).
    while (bodyStart < all.length && /^(TEXTO\s+ACTUALIZADO|modificad[ao]s?\s+por|\(?el anexo|\d{1,2}\.?\d{3}\b)/i.test(all[bodyStart])) bodyStart++;
  }
  const header = parseHeader(all.slice(0, bodyStart));

  const rationale = all.findIndex((l, i) => i >= bodyStart && RATIONALE.test(l));
  const body = all.slice(bodyStart, rationale === -1 ? undefined : rationale);

  const units: Unit[] = [];
  let current: Unit | null = null;
  let structural: string[] = [];
  let annex: string | null = null;
  let skipping = false;

  const headings = () => (annex ? [annex, ...structural] : [...structural]);
  const flush = () => {
    if (current && current.text.trim()) units.push({ ...current, text: current.text.trim() });
    current = null;
  };

  for (let i = 0; i < body.length; i++) {
    const line = body[i];

    const annexMatch = ANNEX.exec(line);
    if (annexMatch && line.length < 120) {
      flush();
      skipping = false;
      annex = line.length <= 40 ? line.replace(/\s*[-–—:.]\s*$/, "") : `Anexo ${annexMatch[1] ?? ""}`.trim();
      structural = [];
      current = { kind: "annex", label: annex.replace(/^ANEXO/i, "Anexo"), headings: [annex], text: "" };
      if (line.length > 40) current.text = `${line}\n`;
      continue;
    }

    if (skipping) continue;

    const article = ARTICLE.exec(line);
    if (article) {
      flush();
      const rest = line.slice(article[0].length);
      if (CLOSING.test(rest) && !annex) {
        // "Artículo 5º.- Comuníquese, etc." — the rest are signatures until an annex.
        skipping = true;
        continue;
      }
      current = { kind: "article", label: articleLabel(article), headings: headings(), text: `${line}\n` };
      continue;
    }

    const isStructural = STRUCTURAL.test(line) || (ROMAN_HEADING.test(line) && looksLikeCapsHeading(line.replace(ROMAN_HEADING, "x")));
    if (isStructural || (looksLikeCapsHeading(line) && ARTICLE.test(body[i + 1] ?? ""))) {
      flush();
      // A "TÍTULO" resets the chapter below it; anything else replaces the last level.
      if (/^T[ÍI]TULO|^LIBRO|^PARTE/i.test(line)) structural = [line];
      else if (/^CAP[ÍI]TULO/i.test(line) && structural.length && /^T[ÍI]TULO|^LIBRO|^PARTE/i.test(structural[0])) structural = [structural[0], line];
      else if (/^SECCI[ÓO]N/i.test(line) && structural.length) structural = [...structural.slice(0, 2), line];
      else structural = [line];
      // A capitals title right after "CAPÍTULO I" is its name, not a new level.
      const next = body[i + 1] ?? "";
      if (isStructural && looksLikeCapsHeading(next) && !ARTICLE.test(next) && !ANNEX.test(next) && !STRUCTURAL.test(next)) {
        structural[structural.length - 1] = `${line} - ${next}`;
        i++;
      }
      continue;
    }

    if (!current) current = { kind: annex ? "annex" : "text", label: annex, headings: headings(), text: "" };
    current.text += `${line}\n`;
  }
  flush();

  return { header, units };
}
