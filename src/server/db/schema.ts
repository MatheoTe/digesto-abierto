import { sql } from "drizzle-orm";
import {
  boolean,
  customType,
  date,
  halfvec,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * Every embedding provider is projected to the same width so a single column
 * (and a single HNSW index) serves them all. Rows remember which model produced
 * them, and retrieval only compares vectors from the active model. Vectors are
 * stored as half precision: the whole municipal corpus has to fit in a free
 * Postgres tier, and fp16 loses nothing measurable on retrieval.
 */
export const EMBEDDING_DIMENSIONS = 1024;

const tsvector = customType<{ data: string }>({
  dataType: () => "tsvector",
});

/** One relation from the Concejo's Base de Normas ("Modificada por: ORDENANZA MUNICIPAL 6089, art. 1"). */
export interface OrdinanceRelation {
  kind: "abroga" | "abrogada_por" | "deroga" | "derogada_por" | "modifica" | "modificada_por" | "otra";
  /** Label as published, e.g. "Modificada por". */
  label: string;
  /** "ORDENANZA MUNICIPAL 6089", "DECRETO D.E. 605-67". */
  act: string;
  /** Ordinance number when the act is a municipal ordinance. */
  ordinance: number | null;
  /** Articles affected, as published ("art. 4, inc. 2"). */
  detail: string | null;
}

export const ordinances = pgTable(
  "ordinances",
  {
    number: integer("number").primaryKey(),
    /** Id in basenormas.concejomdp.gov.ar, for the official record link. */
    sourceId: integer("source_id"),
    sanctionedOn: date("sanctioned_on"),
    promulgatedOn: date("promulgated_on"),
    publishedOn: date("published_on"),
    /** The Concejo's own one-line summary ("contenido"). */
    summary: text("summary").notNull().default(""),
    /** G = general, P = particular. */
    scope: text("scope"),
    /** P = permanente, T = transitoria. */
    character: text("character"),
    inForce: boolean("in_force").notNull(),
    /** Set when the whole ordinance was repealed ("abrogada por Ordenanza 16200"). */
    repealedBy: integer("repealed_by"),
    excludedOn: date("excluded_on"),
    descriptors: text("descriptors").array().notNull().default(sql`'{}'::text[]`),
    relations: jsonb("relations").$type<OrdinanceRelation[]>().notNull().default(sql`'[]'::jsonb`),
    /** Which official text the chunks come from. */
    textSource: text("text_source", { enum: ["actualizado", "original"] }),
    textUrl: text("text_url"),
    /** Amendments the Base de Normas lists that the published text does not incorporate yet. */
    laterAmendments: integer("later_amendments").array().notNull().default(sql`'{}'::integer[]`),
    originalUrl: text("original_url"),
    pdfUrl: text("pdf_url"),
    chunkCount: integer("chunk_count").notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("ordinances_in_force_idx").on(t.inForce)],
);

export const chunks = pgTable(
  "chunks",
  {
    id: uuid("id").primaryKey(),
    ordinanceNumber: integer("ordinance_number")
      .notNull()
      .references(() => ordinances.number, { onDelete: "cascade" }),
    ordinal: integer("ordinal").notNull(),
    /** "record" = the ordinance's summary card; "article" / "annex" / "text" = official text. */
    kind: text("kind", { enum: ["record", "article", "annex", "text"] }).notNull(),
    /** "Art. 4º", "Anexo I" — what a citation shows. */
    label: text("label"),
    content: text("content").notNull(),
    headingPath: text("heading_path").notNull().default(""),
    /** The ordinance's summary, repeated on each chunk so lexical search knows what the article belongs to. */
    context: text("context").notNull().default(""),
    tokenCount: integer("token_count").notNull(),
    contentHash: text("content_hash").notNull(),
    embedding: halfvec("embedding", { dimensions: EMBEDDING_DIMENSIONS }),
    embeddingModel: text("embedding_model"),
    /**
     * Spanish stemming over unaccented text ("habilitación" and "habilitacion"
     * match). Headings and labels weigh most, then the article itself, then
     * the ordinance's summary.
     */
    tsv: tsvector("tsv")
      .notNull()
      .generatedAlwaysAs(
        sql`setweight(to_tsvector('es_unaccent', coalesce(heading_path, '') || ' ' || coalesce(label, '')), 'A') || setweight(to_tsvector('es_unaccent', content), 'B') || setweight(to_tsvector('es_unaccent', context), 'C')`,
      ),
  },
  (t) => [
    uniqueIndex("chunks_ordinance_ordinal_key").on(t.ordinanceNumber, t.ordinal),
    index("chunks_tsv_idx").using("gin", t.tsv),
    index("chunks_embedding_hnsw_idx").using("hnsw", t.embedding.op("halfvec_cosine_ops")),
    index("chunks_embedding_model_idx").on(t.embeddingModel),
  ],
);

/**
 * Content-addressed embedding cache: re-chunking or re-crawling the corpus
 * only pays for chunks whose text actually changed.
 */
export const embeddingCache = pgTable(
  "embedding_cache",
  {
    contentHash: text("content_hash").notNull(),
    model: text("model").notNull(),
    embedding: halfvec("embedding", { dimensions: EMBEDDING_DIMENSIONS }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.contentHash, t.model] })],
);

export interface TraceTimings {
  rewriteMs: number;
  embedMs: number;
  ftsMs: number;
  vectorMs: number;
  fuseMs: number;
  rerankMs: number;
  retrievalMs: number;
  ttftMs: number | null;
  generationMs: number;
  totalMs: number;
  /** Stage spans with start offsets (newer traces only; older ones are derived from durations). */
  spans?: { stage: "rewrite" | "fts" | "vector" | "fuse" | "rerank" | "generate"; startMs: number; durationMs: number }[];
}

export interface TraceRetrievalEntry {
  chunkId: string;
  ordinanceNumber: number;
  ftsRank: number | null;
  vectorRank: number | null;
  fusedScore: number;
  rerankScore: number | null;
}

export interface TraceUsageEntry {
  step: "rewrite" | "embed" | "rerank" | "answer";
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costUsd: number | null;
}

export interface TraceCitation {
  index: number;
  chunkId: string;
}

export const traces = pgTable(
  "traces",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    question: text("question").notNull(),
    rewrittenQuery: text("rewritten_query"),
    answer: text("answer"),
    answerable: boolean("answerable"),
    status: text("status", { enum: ["ok", "error"] }).notNull(),
    error: text("error"),
    llmProvider: text("llm_provider").notNull(),
    llmModel: text("llm_model"),
    embeddingModel: text("embedding_model").notNull(),
    reranker: text("reranker"),
    timings: jsonb("timings").$type<TraceTimings>().notNull(),
    retrieval: jsonb("retrieval").$type<TraceRetrievalEntry[]>().notNull(),
    citations: jsonb("citations").$type<TraceCitation[]>().notNull(),
    usage: jsonb("usage").$type<TraceUsageEntry[]>().notNull(),
    costUsd: numeric("cost_usd", { precision: 12, scale: 6, mode: "number" }),
    totalMs: integer("total_ms").notNull(),
  },
  (t) => [index("traces_created_at_idx").on(t.createdAt.desc())],
);

export type OrdinanceRow = typeof ordinances.$inferSelect;
export type NewOrdinance = typeof ordinances.$inferInsert;
export type ChunkRow = typeof chunks.$inferSelect;
export type TraceRow = typeof traces.$inferSelect;
export type NewTrace = typeof traces.$inferInsert;
