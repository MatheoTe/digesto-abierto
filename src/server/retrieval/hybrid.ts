import { and, asc, cosineDistance, desc, eq, inArray, sql } from "drizzle-orm";
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
  /**
   * The user's own words. Searched alongside the rewritten query and fused: the
   * rewrite adds the ordinances' vocabulary, the original keeps its focus when
   * the rewrite drifts into generic words.
   */
  question?: string;
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

/** Best (lowest) rank among the fused lists whose name matches. */
function bestRank(ranks: Record<string, number | null>, match: (name: string) => boolean): number | null {
  const found = Object.entries(ranks).flatMap(([name, rank]) => (match(name) && rank !== null ? [rank] : []));
  return found.length ? Math.min(...found) : null;
}

/** "Ordenanza 4471", "ord. 15.043", "O-26500": the numbers a question names explicitly. */
export function referencedOrdinances(text: string): number[] {
  const found = new Set<number>();
  for (const m of text.matchAll(/\b(?:ordenanzas?|ord\.?|o\s*-)\s*(?:n(?:[º°o.]|ro\.?|[uú]mero)?\s*)?(\d{1,2}\.\d{3}|\d{3,5})\b/gi)) {
    found.add(Number(m[1].replace(".", "")));
  }
  return [...found].slice(0, 3);
}

/**
 * Lexical ranking, BM25-style: each query lexeme that a chunk contains adds its
 * inverse document frequency, so the rare, specific word ("taxi", "pirotecnia")
 * decides and the common ones ("horas", "trabajo") only break ties. Longer
 * chunks are damped (a 300-line budget annex mentions everything), lexemes in
 * more than 12% of chunks are ignored, and general ordinances weigh 30% more:
 * most of the digest is particular (a permit for one shop, a street name) and
 * a vecino's question is almost always about a general rule.
 */
async function lexicalSearch(db: Db, query: string, limit: number): Promise<{ id: string; score: number }[]> {
  const text = buildTsQuery(query)?.split(" | ").join(" ");
  if (!text) return [];
  const res = (await db.execute(sql`
    with n as (select greatest(reltuples, 1)::float8 as n from pg_class where relname = 'chunks'),
    terms as (
      select distinct s.term, ln((n.n - s.df + 0.5) / (s.df + 0.5) + 1) as idf
      from unnest(tsvector_to_array(to_tsvector('es_unaccent', ${text}))) as l(term)
      join term_stats s on s.term = l.term
      cross join n
      where s.df < greatest(n.n * 0.12, 50)
    ),
    hits as (
      select c.id, sum(t.idf) as s
      from terms t
      join chunks c on c.tsv @@ quote_literal(t.term)::tsquery
      group by c.id
    )
    select c.id, (h.s / (1 + 0.15 * ln(1 + c.token_count / 50.0)) * (case when o.scope = 'G' then 1.3 else 1 end))::float8 as score
    from hits h
    join chunks c on c.id = h.id
    join ordinances o on o.number = c.ordinance_number
    where o.in_force
    order by score desc, c.id
    limit ${limit}`)) as unknown as { rows: { id: string; score: number }[] };
  return res.rows.map((r) => ({ id: r.id, score: Number(r.score) }));
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

/** "Art. 13º (parte 2 de 3)" -> 13; "Anexo I" -> null. */
function articleNumber(label: string | null): number | null {
  const m = label ? /^Art\. (\d+)/.exec(label) : null;
  return m ? Number(m[1]) : null;
}

const MAX_AMENDMENT_PARENTS = 10;
const MAX_AMENDMENTS = 6;

/**
 * For the best-ranked articles of ordinances with later amendments, the chunks
 * of those amending ordinances that name the same article number and the
 * amended ordinance ("Artículo 13º de la Ordenanza Nº 4471", also "4.471").
 * They are inserted right after the article they amend.
 */
async function withAmendments(db: Db, results: RetrievedChunk[]): Promise<RetrievedChunk[]> {
  const parents = results
    .filter((r) => r.kind === "article" && r.laterAmendments.length > 0 && articleNumber(r.label) !== null)
    .slice(0, MAX_AMENDMENT_PARENTS);
  if (!parents.length) return results;
  const present = new Set(results.map((r) => r.chunkId));
  const conditions = parents.map((p) => {
    const n = String(p.ordinanceNumber);
    const dotted = n.length > 3 ? `${n.slice(0, -3)}\\.?${n.slice(-3)}` : n;
    return sql`(${chunks.ordinanceNumber} = any(${sql.raw(`array[${p.laterAmendments.map(Number).join(",")}]::int[]`)})
      and ${chunks.content} ~* ${`art[ií]culos?\\s*${articleNumber(p.label)}\\s*[º°o]?[^0-9]`}
      and ${chunks.content} ~ ${`(^|[^0-9.])${dotted}([^0-9]|$)`})`;
  });
  const found = await db
    .select(selectRetrieved)
    .from(chunks)
    .innerJoin(ordinances, eq(ordinances.number, chunks.ordinanceNumber))
    .where(and(sql`${chunks.kind} <> 'record'`, sql`(${sql.join(conditions, sql` or `)})`))
    .limit(MAX_AMENDMENTS * 2);
  const out = [...results];
  let added = 0;
  for (const parent of parents) {
    const n = articleNumber(parent.label);
    const mine = found.filter(
      (f) =>
        !present.has(f.chunkId) &&
        parent.laterAmendments.includes(f.ordinanceNumber) &&
        new RegExp(`art[ií]culos?\\s*${n}\\s*[º°o]?[^0-9]`, "i").test(f.content),
    );
    for (const f of mine) {
      if (added >= MAX_AMENDMENTS) break;
      present.add(f.chunkId);
      const at = out.findIndex((r) => r.chunkId === parent.chunkId) + 1;
      out.splice(at, 0, {
        ...f,
        laterAmendments: f.laterAmendments ?? [],
        ftsRank: null,
        vectorRank: null,
        vectorSimilarity: null,
        fusedScore: parent.fusedScore,
        rerankScore: null,
      });
      added++;
    }
  }
  return out;
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
  const candidates = Math.max(options.candidates ?? 40, options.k);
  const named = options.ordinanceNumbers ?? [];
  const timings = { embedMs: 0, ftsMs: 0, vectorMs: 0, fuseMs: 0, rerankMs: 0 };
  let embedTokens = 0;
  const onStage = options.onStage ?? (() => {});

  const runFts = async () => {
    if (mode === "vector") {
      onStage("fts", "skipped");
      return {
        general: [] as { id: string }[],
        variants: [] as { id: string }[][],
        original: [] as { id: string }[],
        named: { records: [] as { id: string }[], articles: [] as { id: string }[] },
      };
    }
    onStage("fts", "running");
    const start = performance.now();
    const asked = options.question?.trim();
    // The rewrite may carry several search lines (multi-query): each one is its own ranking.
    const lines = query.split("\n").map((l) => l.trim()).filter(Boolean);
    const [variants, original, namedRows] = await Promise.all([
      Promise.all(lines.map((line) => lexicalSearch(db, line, candidates))),
      asked && !lines.includes(asked) ? lexicalSearch(db, asked, candidates) : Promise.resolve([]),
      referencedSearch(db, query, named, Math.min(candidates, 10)),
    ]);
    timings.ftsMs = since(start);
    onStage("fts", "done", timings.ftsMs);
    return { general: variants[0] ?? [], variants: variants.slice(1), original, named: namedRows };
  };

  const runVector = async () => {
    if (mode === "fts") {
      onStage("vector", "skipped");
      return [];
    }
    onStage("vector", "running");
    let start = performance.now();
    let embedded;
    try {
      embedded = await embeddings.embedQuery(options.question?.trim() || query.split("\n")[0]);
    } catch (err) {
      // A rate-limited or unreachable embedding API degrades the search to words only;
      // it never fails the question.
      console.warn("[digesto] vector stage skipped:", err instanceof Error ? err.message.slice(0, 200) : err);
      timings.embedMs = since(start);
      onStage("vector", "skipped");
      return [];
    }
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
      { name: "question", ids: fts.original.map((r) => r.id) },
      ...fts.variants.map((rows, i) => ({ name: `fts${i + 2}`, ids: rows.map((r) => r.id) })),
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
  const top = fused.slice(0, useReranker ? Math.min(candidates, 40) : options.k);
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
        ftsRank: bestRank(item.ranks, (name) => name === "question" || name.startsWith("fts")),
        vectorRank: item.ranks.vector,
        vectorSimilarity: similarity.get(item.id) ?? null,
        fusedScore: item.score,
        rerankScore: null,
      },
    ];
  });

  // Follow the amendment chain: when an article of an ordinance that was amended later made
  // the pool, add the article of the later ordinance that rewrote it ("Modifícase el
  // Artículo 13º de la Ordenanza Nº 4471…"). The consolidated text may not include it yet.
  results = await withAmendments(db, results);

  let rerankTokens = 0;
  let rerankCostUsd: number | null | undefined;
  if (useReranker && reranker) {
    onStage("rerank", "running");
    start = performance.now();
    let reranked: Awaited<ReturnType<Reranker["rerank"]>> | null;
    try {
      reranked = await reranker.rerank(
        query,
        results.map((r) => corpusEmbeddingInput(r)),
        options.k,
      );
    } catch (err) {
      // Same as the vector stage: without the reranker, the fused order stands.
      console.warn("[digesto] rerank skipped:", err instanceof Error ? err.message.slice(0, 200) : err);
      reranked = null;
    }
    timings.rerankMs = since(start);
    if (reranked) {
      rerankTokens = reranked.tokens;
      rerankCostUsd = reranked.costUsd;
      const ordered = reranked.results.map(({ index, score }) => ({ ...results[index], rerankScore: score }));
      const top = ordered.slice(0, options.k).map((o) => o.chunkId);
      const pinned = results.filter((r) => pinnedIds.has(r.chunkId) && !top.includes(r.chunkId));
      results = [...pinned, ...ordered];
    } else {
      results = [...results.filter((r) => pinnedIds.has(r.chunkId)), ...results.filter((r) => !pinnedIds.has(r.chunkId))];
    }
    onStage("rerank", reranked ? "done" : "skipped", reranked ? timings.rerankMs : undefined);
  } else {
    const pinned = results.filter((r) => pinnedIds.has(r.chunkId));
    results = [...pinned, ...results.filter((r) => !pinnedIds.has(r.chunkId))];
    onStage("rerank", "skipped");
  }

  return { chunks: results.slice(0, options.k), timings, embedTokens, rerankTokens, rerankCostUsd };
}
