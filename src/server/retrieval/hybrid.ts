import { and, asc, cosineDistance, desc, eq, inArray, sql, type SQL } from "drizzle-orm";
import { corpusEmbeddingInput } from "../corpus/chunks";
import type { Db } from "../db/client";
import { chunks, ordinances } from "../db/schema";
import type { EmbeddingProvider } from "../providers/embeddings/types";
import type { Reranker } from "../providers/rerank";
import { buildTsQuery } from "./fts-query";
import { reciprocalRankFusion } from "./rrf";

export type RetrievalMode = "hybrid" | "fts" | "vector";

export interface RetrievalOptions {
  /** Number of chunks returned. */
  k: number;
  mode?: RetrievalMode;
  /** Candidates pulled from each retriever before fusion. */
  candidates?: number;
  /** RRF damping constant. */
  rrfK?: number;
  /** Apply the reranker (if one is configured) to the fused candidates. */
  rerank?: boolean;
  /**
   * Ordinances the user named ("¿sigue vigente la Ordenanza 15043?"). Their
   * record card is always included, repealed or not, and their articles join
   * the fusion as a third ranking.
   */
  ordinanceNumbers?: number[];
  /** Progress callback for live pipeline visualisation (stage start / end with duration). */
  onStage?: (stage: RetrievalStage, status: "running" | "done" | "skipped", ms?: number) => void;
}

export type RetrievalStage = "fts" | "vector" | "fuse" | "rerank";

export interface RetrievedChunk {
  chunkId: string;
  ordinanceNumber: number;
  ordinanceSummary: string;
  sanctionedOn: string | null;
  inForce: boolean;
  repealedBy: number | null;
  textSource: "actualizado" | "original" | null;
  textUrl: string | null;
  laterAmendments: number[];
  kind: "record" | "article" | "annex" | "text";
  label: string | null;
  content: string;
  headingPath: string;
  context: string;
  ftsRank: number | null;
  vectorRank: number | null;
  vectorSimilarity: number | null;
  fusedScore: number;
  rerankScore: number | null;
}

export interface RetrievalResult {
  chunks: RetrievedChunk[];
  timings: { embedMs: number; ftsMs: number; vectorMs: number; fuseMs: number; rerankMs: number };
  embedTokens: number;
  rerankTokens: number;
  /** Reranker cost when it reports one (LLM reranker); otherwise priced per token by the caller. */
  rerankCostUsd?: number | null;
}

export interface RetrievalDeps {
  db: Db;
  embeddings: EmbeddingProvider;
  reranker?: Reranker | null;
}

const since = (start: number) => Math.round(performance.now() - start);

/** "Ordenanza 4471", "ord. 15.043", "O-26500": the numbers a question names explicitly. */
export function referencedOrdinances(text: string): number[] {
  const found = new Set<number>();
  for (const m of text.matchAll(/\b(?:ordenanzas?|ord\.?|o\s*-)\s*(?:n(?:[º°o.]|ro\.?|[uú]mero)?\s*)?(\d{1,2}\.\d{3}|\d{3,5})\b/gi)) {
    found.add(Number(m[1].replace(".", "")));
  }
  return [...found].slice(0, 3);
}

async function lexicalSearch(db: Db, query: string, limit: number, scope?: SQL) {
  const tsQuery = buildTsQuery(query);
  if (!tsQuery) return [];
  const q = sql`to_tsquery('es_unaccent', ${tsQuery})`;
  const score = sql<number>`ts_rank_cd(${chunks.tsv}, ${q}, 32)`;
  // ts_rank_cd ties are common for short queries; ts_rank (term frequency) breaks most of them.
  const tieBreak = sql<number>`ts_rank(${chunks.tsv}, ${q})`;
  return db
    .select({ id: chunks.id, score })
    .from(chunks)
    .innerJoin(ordinances, eq(ordinances.number, chunks.ordinanceNumber))
    .where(and(sql`${chunks.tsv} @@ ${q}`, eq(ordinances.inForce, true), scope))
    .orderBy(desc(score), desc(tieBreak), asc(chunks.id))
    .limit(limit);
}

async function vectorSearch(db: Db, vector: number[], model: string, limit: number) {
  if (vector.every((v) => v === 0)) return [];
  // Only chunks of ordinances in force carry a vector, so no join is needed here
  // and the HNSW index serves the ORDER BY directly.
  const distance = cosineDistance(chunks.embedding, vector);
  return db
    .select({ id: chunks.id, similarity: sql<number>`1 - (${distance})` })
    .from(chunks)
    .where(eq(chunks.embeddingModel, model))
    .orderBy(distance)
    .limit(limit);
}

/** The named ordinances: record card first, then their articles that best match the question. */
async function referencedSearch(db: Db, query: string, numbers: number[], limit: number) {
  if (!numbers.length) return { records: [] as { id: string }[], articles: [] as { id: string }[] };
  const records = await db
    .select({ id: chunks.id })
    .from(chunks)
    .where(and(inArray(chunks.ordinanceNumber, numbers), eq(chunks.kind, "record")));
  const tsQuery = buildTsQuery(query.replace(/\b\d{3,5}\b/g, " "));
  let articles: { id: string }[] = [];
  if (tsQuery) {
    const q = sql`to_tsquery('es_unaccent', ${tsQuery})`;
    articles = await db
      .select({ id: chunks.id })
      .from(chunks)
      .where(and(inArray(chunks.ordinanceNumber, numbers), sql`${chunks.kind} <> 'record'`, sql`${chunks.tsv} @@ ${q}`))
      .orderBy(desc(sql`ts_rank_cd(${chunks.tsv}, ${q}, 32)`), asc(chunks.ordinal))
      .limit(limit);
  }
  return { records, articles };
}

const selectRetrieved = {
  chunkId: chunks.id,
  ordinanceNumber: chunks.ordinanceNumber,
  ordinanceSummary: ordinances.summary,
  sanctionedOn: ordinances.sanctionedOn,
  inForce: ordinances.inForce,
  repealedBy: ordinances.repealedBy,
  textSource: ordinances.textSource,
  textUrl: ordinances.textUrl,
  laterAmendments: ordinances.laterAmendments,
  kind: chunks.kind,
  label: chunks.label,
  content: chunks.content,
  headingPath: chunks.headingPath,
  context: chunks.context,
};

/**
 * Hybrid retrieval: Postgres full-text search (Spanish, unaccented) and
 * pgvector similarity run independently, plus a third ranking for any
 * ordinance the question names by number; Reciprocal Rank Fusion merges them.
 * An optional cross-encoder reranker reorders the fused candidates, but the
 * named ordinances' record cards always survive it.
 */
export async function retrieve(deps: RetrievalDeps, query: string, options: RetrievalOptions): Promise<RetrievalResult> {
  const { db, embeddings, reranker } = deps;
  // A words-only deployment has no vectors to search.
  const mode = embeddings.kind === "none" ? "fts" : (options.mode ?? "hybrid");
  const candidates = Math.max(options.candidates ?? 30, options.k);
  const named = options.ordinanceNumbers ?? [];
  const timings = { embedMs: 0, ftsMs: 0, vectorMs: 0, fuseMs: 0, rerankMs: 0 };
  let embedTokens = 0;
  const onStage = options.onStage ?? (() => {});

  const runFts = async () => {
    if (mode === "vector") {
      onStage("fts", "skipped");
      return { general: [] as { id: string }[], named: { records: [] as { id: string }[], articles: [] as { id: string }[] } };
    }
    onStage("fts", "running");
    const start = performance.now();
    const [general, namedRows] = await Promise.all([
      lexicalSearch(db, query, candidates),
      referencedSearch(db, query, named, Math.min(candidates, 10)),
    ]);
    timings.ftsMs = since(start);
    onStage("fts", "done", timings.ftsMs);
    return { general, named: namedRows };
  };

  const runVector = async () => {
    if (mode === "fts") {
      onStage("vector", "skipped");
      return [];
    }
    onStage("vector", "running");
    let start = performance.now();
    const embedded = await embeddings.embedQuery(query);
    timings.embedMs = since(start);
    embedTokens = embedded.tokens;
    start = performance.now();
    const rows = await vectorSearch(db, embedded.vectors[0], embeddings.model, candidates);
    timings.vectorMs = since(start);
    onStage("vector", "done", timings.embedMs + timings.vectorMs);
    return rows;
  };

  const [fts, vectorRows] = await Promise.all([runFts(), runVector()]);

  onStage("fuse", "running");
  let start = performance.now();
  const fused = reciprocalRankFusion(
    [
      { name: "fts", ids: fts.general.map((r) => r.id) },
      { name: "vector", ids: vectorRows.map((r) => r.id) },
      { name: "named", ids: [...fts.named.records, ...fts.named.articles].map((r) => r.id) },
    ],
    options.rrfK ?? 60,
  );
  timings.fuseMs = since(start);
  onStage("fuse", "done", timings.fuseMs);

  const useReranker = options.rerank !== false && !!reranker;
  // A named ordinance's record card answers "is it in force / what is it about": it always
  // makes the pool, whatever its fused rank, and survives the reranker below.
  const pinnedIds = new Set(fts.named.records.map((r) => r.id));
  const top = fused.slice(0, useReranker ? Math.min(candidates, 24) : options.k);
  const pool = [...fused.filter((f) => pinnedIds.has(f.id) && !top.includes(f)), ...top];
  if (pool.length === 0) {
    onStage("rerank", "skipped");
    return { chunks: [], timings, embedTokens, rerankTokens: 0 };
  }

  const rows = await db
    .select(selectRetrieved)
    .from(chunks)
    .innerJoin(ordinances, eq(ordinances.number, chunks.ordinanceNumber))
    .where(
      inArray(
        chunks.id,
        pool.map((p) => p.id),
      ),
    );
  const byId = new Map(rows.map((r) => [r.chunkId, r]));
  const similarity = new Map(vectorRows.map((r) => [r.id, Number(r.similarity)]));

  let results: RetrievedChunk[] = pool.flatMap((item) => {
    const row = byId.get(item.id);
    if (!row) return [];
    return [
      {
        ...row,
        laterAmendments: row.laterAmendments ?? [],
        ftsRank: item.ranks.fts,
        vectorRank: item.ranks.vector,
        vectorSimilarity: similarity.get(item.id) ?? null,
        fusedScore: item.score,
        rerankScore: null,
      },
    ];
  });

  let rerankTokens = 0;
  let rerankCostUsd: number | null | undefined;
  if (useReranker && reranker) {
    onStage("rerank", "running");
    start = performance.now();
    const reranked = await reranker.rerank(
      query,
      results.map((r) => corpusEmbeddingInput(r)),
      options.k,
    );
    timings.rerankMs = since(start);
    rerankTokens = reranked.tokens;
    rerankCostUsd = reranked.costUsd;
    const ordered = reranked.results.map(({ index, score }) => ({ ...results[index], rerankScore: score }));
    const top = ordered.slice(0, options.k).map((o) => o.chunkId);
    const pinned = results.filter((r) => pinnedIds.has(r.chunkId) && !top.includes(r.chunkId));
    results = [...pinned, ...ordered];
    onStage("rerank", "done", timings.rerankMs);
  } else {
    const pinned = results.filter((r) => pinnedIds.has(r.chunkId));
    results = [...pinned, ...results.filter((r) => !pinnedIds.has(r.chunkId))];
    onStage("rerank", "skipped");
  }

  return { chunks: results.slice(0, options.k), timings, embedTokens, rerankTokens, rerankCostUsd };
}
