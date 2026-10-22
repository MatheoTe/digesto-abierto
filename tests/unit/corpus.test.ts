import { describe, expect, it } from "vitest";
import { buildChunks, corpusEmbeddingInput, laterAmendments, recordContent } from "@/server/corpus/chunks";
import { decodeBytes, decodeEntities, htmlToText } from "@/server/corpus/html";
import { parseRecordPage, toOrdinanceRow, type SourceRecord } from "@/server/corpus/record";
import { segmentOrdinance } from "@/server/corpus/segment";
import { referencedOrdinances } from "@/server/retrieval/hybrid";
import { buildTsQuery } from "@/server/retrieval/fts-query";
import { fold } from "@/server/text/terms";

/** Shape of the Concejo's LibreOffice exports: header lines, a consolidated-text note, chapters, articles, signatures, rationale. */
const CONSOLIDATED = `<!DOCTYPE HTML><html><head><meta http-equiv="content-type" content="text/html; charset=utf-8"/>
<style>p { margin: 0 }</style></head><body>
<div title="header"><p><img src="data:image/jpeg;base64,AAAA"/></p></div>
<p>TEXTO ACTUALIZADO</p>
<p>Municipalidad
del Partido de General Pueyrredon</p>
<p>Fecha de sanci&oacute;n: 09/03/1979</p>
<p>ORDENANZA N&ordm; 4471</p>
<p>TEXTO ACTUALIZADO</p>
<p>Modificada por Ordenanzas: 4534, 4887,</p>
<p>21621 23868, (el anexo I se incorpora al final)</p>
<p>I - DERECHO APLICABLE</p>
<p>Art&iacute;culo 1&ordm;.- El servicio de taxis se
regir&aacute; por la ordenanza.</p>
<p>V - SERVICIO OBLIGATORIO</p>
<p>Art&iacute;culo 16&ordm;.- Todo taxi deber&aacute; cumplir un turno diario de ocho (8) horas.</p>
<p>(Ordenanza 6089, art. 1&ordm;)</p>
<p>Art&iacute;culo 15&ordm; bis.- Los taxis llevar&aacute;n bot&oacute;n antip&aacute;nico.</p>
<p>Art&iacute;culo 17&ordm;.- Comun&iacute;quese, etc.-</p>
<p>Bustos Guglielmotti</p>
<p>ANEXO I</p>
<p>Cuadro tarifario del servicio de taxis vigente para todo el partido.</p>
<p>FUNDAMENTOS</p>
<p>El presente proyecto tiene por objeto ordenar el servicio.</p>
</body></html>`;

describe("htmlToText", () => {
  it("joins paragraphs wrapped over several source lines and drops images and styles", () => {
    const text = htmlToText(CONSOLIDATED);
    expect(text).toContain("Municipalidad del Partido de General Pueyrredon");
    expect(text).toContain("Artículo 1º.- El servicio de taxis se regirá por la ordenanza.");
    expect(text).not.toMatch(/base64|margin/);
  });

  it("decodes named and numeric entities", () => {
    expect(decodeEntities("Art&iacute;culo 4&#186; &ndash; &#x41;&quot;")).toBe('Artículo 4º – A"');
    expect(decodeEntities("&desconocida;")).toBe("&desconocida;");
  });

  it("reads windows-1252 when the file declares it, and when UTF-8 would be broken", () => {
    const latin = Uint8Array.from([...Buffer.from("<meta charset=windows-1252>Art"), 0xed, ...Buffer.from("culo")]);
    expect(decodeBytes(latin)).toContain("Artículo");
    const undeclared = Uint8Array.from([...Buffer.from("Habilitaci"), 0xf3, 0x6e]);
    expect(decodeBytes(undeclared)).toBe("Habilitación");
  });
});

describe("segmentOrdinance", () => {
  const { header, units } = segmentOrdinance(htmlToText(CONSOLIDATED));

  it("parses the header: number, consolidated text and the amendments it incorporates", () => {
    expect(header.number).toBe(4471);
    expect(header.consolidated).toBe(true);
    expect(header.amendedBy).toEqual([4534, 4887, 21621, 23868]);
  });

  it("splits by article, keeps the chapter heading and the amendment note, skips signatures and rationale", () => {
    expect(units.map((u) => [u.kind, u.label, u.headings.join(" > ")])).toEqual([
      ["article", "Art. 1º", "I - DERECHO APLICABLE"],
      ["article", "Art. 16º", "V - SERVICIO OBLIGATORIO"],
      ["article", "Art. 15º bis", "V - SERVICIO OBLIGATORIO"],
      ["annex", "Anexo I", "ANEXO I"],
    ]);
    expect(units[1].text).toContain("(Ordenanza 6089, art. 1º)");
    const all = units.map((u) => u.text).join("\n");
    expect(all).not.toContain("Bustos");
    expect(all).not.toContain("FUNDAMENTOS");
    expect(all).not.toContain("tiene por objeto");
  });

  it("handles an original text without chapters", () => {
    const original = segmentOrdinance(
      "ORDENANZA Nº 26500\nArtículo 1º.- Otórgase el título de Visitante Notable.\nArtículo 2º.- Comuníquese, etc.-\nFirma",
    );
    expect(original.header).toMatchObject({ number: 26500, consolidated: false, amendedBy: [] });
    expect(original.units).toHaveLength(1);
    expect(original.units[0].headings).toEqual([]);
  });
});

const RECORD_PAGE = `
<p><strong class="text-uppercase">Descriptores:</strong>
  <a href="https://basenormas.concejomdp.gov.ar/normas/search/simple/normas/1" class="badge">TAXIS</a>
  <a href="https://basenormas.concejomdp.gov.ar/normas/search/simple/normas/2" class="badge">TARIFA</a>
</p>
<ul>
  <li><strong class="text-uppercase">Abroga:</strong>
    <a href="https://basenormas.concejomdp.gov.ar/normas/show/normas/4353"><i class="fa fa-link"></i> ORDENANZA MUNICIPAL 1509</a>
    <a class="link-norma-doc" href="https://www.concejomdp.gov.ar/biblioteca/docs/o1509.html">Texto</a></li>
  <li><strong class="text-uppercase">Modificada por:</strong>
    <a href="https://basenormas.concejomdp.gov.ar/normas/show/normas/752"><i class="fa fa-link"></i> ORDENANZA MUNICIPAL 23868</a>
    art 7&ordm;, inciso 1)
    <a class="link-norma-doc" href="https://www.concejomdp.gov.ar/biblioteca/docs/o23868.html">Texto</a></li>
  <li><strong class="text-uppercase">Modificada por:</strong>
    <a href="https://basenormas.concejomdp.gov.ar/normas/show/normas/900"><i class="fa fa-link"></i> ORDENANZA MUNICIPAL 27004</a>
    Varios artículos</li>
  <li><strong class="text-uppercase">Abroga:</strong>
    <a href="https://basenormas.concejomdp.gov.ar/normas/show/decretos/1"><i class="fa fa-link"></i> DECRETO D.E. 605-67</a></li>
</ul>`;

const SOURCE: SourceRecord = {
  id: 765,
  nro: "4471",
  fec_sancion: "1979-03-09",
  fec_promulga: "1979-03-09",
  fec_publica: "1979-06-05",
  contenido: "Reglamenta el servicio de taxis.",
  alcance: "G",
  caracter: "P",
  abrogacion_a: "",
  abrogacion_n: "",
  fec_excluido: null,
  url_html: "https://www.concejomdp.gov.ar/biblioteca/docs/o4471.html?v=abc",
  url_pdf: "https://www.concejomdp.gov.ar/biblioteca/docs/o4471.pdf?v=def",
  url_actualizado_html: "https://www.concejomdp.gov.ar/biblioteca/docs/o4471a.html?v=123",
};

describe("record", () => {
  const page = parseRecordPage(RECORD_PAGE);

  it("reads descriptors and typed relations with the affected articles", () => {
    expect(page.descriptors).toEqual(["TAXIS", "TARIFA"]);
    expect(page.relations).toEqual([
      { kind: "abroga", label: "Abroga", act: "ORDENANZA MUNICIPAL 1509", ordinance: 1509, detail: null },
      { kind: "modificada_por", label: "Modificada por", act: "ORDENANZA MUNICIPAL 23868", ordinance: 23868, detail: "art 7º, inciso 1)" },
      { kind: "modificada_por", label: "Modificada por", act: "ORDENANZA MUNICIPAL 27004", ordinance: 27004, detail: "Varios artículos" },
      { kind: "abroga", label: "Abroga", act: "DECRETO D.E. 605-67", ordinance: null, detail: null },
    ]);
  });

  it("builds the row: in force unless repealed or excluded, URLs without cache busters", () => {
    const row = toOrdinanceRow(SOURCE, page, { source: "actualizado", url: "https://www.concejomdp.gov.ar/biblioteca/docs/o4471a.html" });
    expect(row).toMatchObject({ number: 4471, inForce: true, repealedBy: null, pdfUrl: "https://www.concejomdp.gov.ar/biblioteca/docs/o4471.pdf" });
    const repealed = toOrdinanceRow({ ...SOURCE, abrogacion_n: "16200", fec_excluido: "2004-08-09 00:00:00" }, null, null);
    expect(repealed).toMatchObject({ inForce: false, repealedBy: 16200, excludedOn: "2004-08-09", textSource: null });
  });

  it("flags amendments newer than what the consolidated text incorporates", () => {
    const row = toOrdinanceRow(SOURCE, page, { source: "actualizado", url: "x" });
    const segmented = segmentOrdinance(htmlToText(CONSOLIDATED));
    expect(laterAmendments(row, segmented)).toEqual([27004]);
    // An original text incorporates nothing: every amendment is "later".
    expect(laterAmendments({ ...row, textSource: "original" }, null)).toEqual([23868, 27004]);
  });

  it("writes a record card that says what the ordinance is and whether its text is current", () => {
    const row = toOrdinanceRow(SOURCE, page, { source: "actualizado", url: "x" });
    const card = recordContent(row, [27004]);
    expect(card).toContain("Ordenanza 4471, sancionada el 09/03/1979.");
    expect(card).toContain("Temas: taxis, tarifa.");
    expect(card).toContain("Estado: vigente.");
    expect(card).toContain("Modificada por las ordenanzas 23868 y 27004.");
    expect(card).toContain("no incorpora todavía la Ordenanza 27004.");
  });
});

describe("buildChunks", () => {
  const row = toOrdinanceRow(SOURCE, parseRecordPage(RECORD_PAGE), { source: "actualizado", url: "x" });
  const chunks = buildChunks(row, segmentOrdinance(htmlToText(CONSOLIDATED)));

  it("starts with the record card, then one chunk per article with stable ids", () => {
    expect(chunks.map((c) => [c.kind, c.label])).toEqual([
      ["record", "Ficha"],
      ["article", "Art. 1º"],
      ["article", "Art. 16º"],
      ["article", "Art. 15º bis"],
      ["annex", "Anexo I"],
    ]);
    expect(chunks.map((c) => c.ordinal)).toEqual([0, 1, 2, 3, 4]);
    expect(buildChunks(row, segmentOrdinance(htmlToText(CONSOLIDATED)))[2].id).toBe(chunks[2].id);
  });

  it("splits a long article into labelled parts", () => {
    const long = `ORDENANZA Nº 4471\nArtículo 4º.- Requisitos:\n${Array.from({ length: 40 }, (_, i) => `${i + 1}) Requisito número ${i + 1} para habilitar el vehículo como taxi.`).join("\n")}`;
    const parts = buildChunks(row, segmentOrdinance(long)).filter((c) => c.kind === "article");
    expect(parts.length).toBeGreaterThan(1);
    expect(parts[0].label).toBe(`Art. 4º (parte 1 de ${parts.length})`);
    expect(parts.every((p) => p.tokenCount <= 450)).toBe(true);
  });

  it("embeds articles with the ordinance and where in it they are", () => {
    expect(corpusEmbeddingInput(chunks[2])).toBe(
      `Ordenanza 4471: Reglamenta el servicio de taxis.\nV - SERVICIO OBLIGATORIO — Art. 16º\n\n${chunks[2].content}`,
    );
  });
});

describe("query helpers", () => {
  it("finds the ordinance numbers a question names", () => {
    expect(referencedOrdinances("¿Sigue vigente la Ordenanza 15.043?")).toEqual([15043]);
    expect(referencedOrdinances("Qué dice la ord. 4471 y la O-26500")).toEqual([4471, 26500]);
    expect(referencedOrdinances("ordenanza nº 9.920 art 3")).toEqual([9920]);
    expect(referencedOrdinances("¿Cuántas horas trabaja un taxi en 2024?")).toEqual([]);
  });

  it("builds an OR tsquery without accents, stopwords or operators", () => {
    expect(fold("Habilitación ÑANDÚ")).toBe("habilitacion nandu");
    expect(buildTsQuery("¿Qué necesito para la habilitación de un food truck en Mar del Plata?")).toBe("habilitacion | food | truck");
    expect(buildTsQuery("a & b | !c")).toBeNull();
  });
});
