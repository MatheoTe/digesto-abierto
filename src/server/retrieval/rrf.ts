export interface RankedList {
  name: string;
  /** Item ids, best first. */
  ids: string[];
  /** Relative weight of this list in the fusion (default 1). */
  weight?: number;
}

export interface FusedItem {
  id: string;
  score: number;
  /** 1-based rank of the item in each input list, or null if absent. */
  ranks: Record<string, number | null>;
}

/**
 * Reciprocal Rank Fusion (Cormack, Clarke & Büttcher, SIGIR 2009):
 *
 *     score(d) = Σ_lists  weight / (k + rank_list(d))
 *
 * RRF only looks at ranks, never at raw scores, which is exactly why it suits
 * hybrid search: ts_rank_cd values and cosine similarities live on unrelated
 * scales that would need per-corpus calibration to be combined linearly.
 * k (60 in the paper) dampens the advantage of the very top positions so an
 * item ranked well by both retrievers beats one ranked first by only one.
 *
 * Ties are broken by best single rank, then by id, so output is deterministic.
 */
export function reciprocalRankFusion(lists: RankedList[], k = 60): FusedItem[] {
  if (k < 0) throw new Error("k must be non-negative");
  const items = new Map<string, FusedItem>();

  for (const list of lists) {
    const weight = list.weight ?? 1;
    const seen = new Set<string>();
    list.ids.forEach((id, position) => {
      if (seen.has(id)) return; // a list may not vote twice for the same item
      seen.add(id);
      const rank = position + 1;
      let item = items.get(id);
      if (!item) {
        item = { id, score: 0, ranks: Object.fromEntries(lists.map((l) => [l.name, null])) };
        items.set(id, item);
      }
      item.score += weight / (k + rank);
      item.ranks[list.name] = rank;
    });
  }

  const bestRank = (item: FusedItem) =>
    Math.min(...Object.values(item.ranks).map((r) => r ?? Number.POSITIVE_INFINITY));

  return [...items.values()].sort(
    (a, b) => b.score - a.score || bestRank(a) - bestRank(b) || a.id.localeCompare(b.id),
  );
}
