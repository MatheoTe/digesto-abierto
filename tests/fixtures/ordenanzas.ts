import type { OrdinanceRelation } from "@/server/db/schema";
import type { SourceRecord } from "@/server/corpus/record";

/**
 * A tiny, fictional digest for the integration tests. The numbers (9000x) do
 * not exist in General Pueyrredon on purpose: the texts are written for the
 * tests and must never be mistaken for the real ones.
 */
export interface FixtureOrdinance {
  record: SourceRecord;
  page: { descriptors: string[]; relations: OrdinanceRelation[] } | null;
  text: { source: "actualizado" | "original"; body: string } | null;
}

const base = (nro: number, contenido: string, extra: Partial<SourceRecord> = {}): SourceRecord => ({
  id: nro - 80000,
  nro: String(nro),
  fec_sancion: "2020-05-14",
  fec_promulga: "2020-05-20",
  fec_publica: "2020-06-01",
  contenido,
  alcance: "G",
  caracter: "P",
  abrogacion_a: "",
  abrogacion_n: "",
  fec_excluido: null,
  url_html: `https://www.concejomdp.gov.ar/biblioteca/docs/o${nro}.html`,
  url_pdf: `https://www.concejomdp.gov.ar/biblioteca/docs/o${nro}.pdf`,
  url_actualizado_html: `https://www.concejomdp.gov.ar/biblioteca/docs/o${nro}a.html`,
  ...extra,
});

const rel = (kind: OrdinanceRelation["kind"], label: string, ordinance: number, detail: string | null = null): OrdinanceRelation => ({
  kind,
  label,
  act: `ORDENANZA MUNICIPAL ${ordinance}`,
  ordinance,
  detail,
});

export const FIXTURE_ORDINANCES: FixtureOrdinance[] = [
  {
    record: base(90001, "Reglamenta el servicio de transporte de personas en automóviles de alquiler con taxímetro."),
    page: {
      descriptors: ["TAXIS", "HABILITACIONES"],
      relations: [rel("modificada_por", "Modificada por", 90010, "art. 16"), rel("modificada_por", "Modificada por", 90020, "incorpora art. 30")],
    },
    text: {
      source: "actualizado",
      body: `ORDENANZA Nº 90001
TEXTO ACTUALIZADO
Modificada por Ordenanzas: 90010
I - DISPOSICIONES GENERALES
Artículo 1º.- El servicio de taxis se considera de orden público y de prestación obligatoria.
II - SERVICIO OBLIGATORIO
Artículo 16º.- Todo taxi deberá cumplir un turno diario obligatorio de servicio de ocho (8) horas de duración.
(Ordenanza 90010, art. 1º)
Artículo 23º.- El conductor de un taxi libre no podrá negarse a llevar pasajeros, salvo que estén en evidente estado de ebriedad.
Artículo 24º.- Comuníquese, etc.-`,
    },
  },
  {
    record: base(90020, "Incorpora el artículo 30 a la Ordenanza 90001, sobre el botón antipánico en los taxis.", { fec_sancion: "2026-05-14" }),
    page: { descriptors: ["TAXIS", "SEGURIDAD"], relations: [rel("modifica", "Modifica", 90001, "incorpora art. 30")] },
    text: {
      source: "original",
      body: `ORDENANZA Nº 90020
Artículo 1º.- Incorpórase como artículo 30º de la Ordenanza 90001 el siguiente texto: "Todos los taxis deberán contar con un botón antipánico conectado al Centro de Operaciones y Monitoreo".
Artículo 2º.- Comuníquese, etc.-`,
    },
  },
  {
    record: base(90003, "Prohíbe fumar en locales gastronómicos cerrados.", { abrogacion_a: "or", abrogacion_n: "90004", fec_excluido: "2022-01-10 00:00:00" }),
    page: null,
    text: null,
  },
  {
    record: base(90004, "Establece ambientes libres de humo de tabaco en espacios cerrados de acceso público."),
    page: { descriptors: ["TABACO", "SALUD"], relations: [rel("abroga", "Abroga", 90003)] },
    text: {
      source: "original",
      body: `ORDENANZA Nº 90004
Artículo 1º.- Prohíbese fumar en bares, restaurantes y todo espacio cerrado de acceso público del Partido.
Artículo 2º.- Los titulares de los locales deberán exhibir carteles con la leyenda "Ambiente libre de humo".
Artículo 3º.- Abrógase la Ordenanza 90003.
Artículo 4º.- Comuníquese, etc.-`,
    },
  },
];
