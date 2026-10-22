import { STOPWORDS, tokenize } from "../text/terms";

const MAX_TERMS = 32;

/**
 * Turn free text into a to_tsquery() expression that ORs the content terms.
 *
 * websearch_to_tsquery/plainto_tsquery AND every word, so a natural-language
 * question ("how long are dead-lettered events kept?") only matches chunks
 * that contain all of its words — recall collapses. OR-ing the terms and
 * letting ts_rank_cd reward chunks that match more (and denser) terms behaves
 * much closer to BM25-style ranking.
 *
 * Tokens come from `tokenize`, which only emits [a-z0-9] plus inner "-" or
 * ".", so nothing can inject tsquery operators. Stemming is left to Postgres.
 */
export function buildTsQuery(text: string): string | null {
  const terms = [...new Set(tokenize(text).filter((t) => !STOPWORDS.has(t) && t.length > 1))].slice(0, MAX_TERMS);
  return terms.length ? terms.join(" | ") : null;
}
