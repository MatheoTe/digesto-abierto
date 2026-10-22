import { STOPWORDS, stem, tokenize } from "../../text/terms";
import type { EmbeddingBatch, EmbeddingProvider } from "./types";

/** 32-bit FNV-1a. Deterministic across platforms and Node versions. */
function fnv1a(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * Feature-hashed bag of n-grams ("hashing trick"):
 *  - stemmed content words (weight 1.0)
 *  - word bigrams over the stemmed sequence (0.5) for a bit of word order
 *  - character trigrams inside each word (0.25), which tolerate typos and
 *    morphology ("rotate" ~ "rotation")
 * Each feature lands in one of `dimensions` buckets with a hash-derived sign,
 * term frequency is dampened with 1 + ln(tf), and the vector is L2-normalised
 * so cosine similarity behaves.
 *
 * This is NOT a semantic model — it cannot know that "holiday" ≈ "time off".
 * It exists so the full pipeline (pgvector, HNSW, RRF, evals) runs offline and
 * deterministically. The eval report shows exactly how much a real model adds.
 */
export class LocalHashEmbeddingProvider implements EmbeddingProvider {
  readonly kind = "local" as const;
  readonly model: string;

  constructor(readonly dimensions = 1024) {
    this.model = `local-hash-v1@${dimensions}`;
  }

  embed(text: string): number[] {
    const features = new Map<string, { weight: number; count: number }>();
    const add = (feature: string, weight: number) => {
      const entry = features.get(feature);
      if (entry) entry.count += 1;
      else features.set(feature, { weight, count: 1 });
    };

    const words = tokenize(text)
      .filter((t) => !STOPWORDS.has(t))
      .map(stem);

    words.forEach((word, i) => {
      add(`w:${word}`, 1);
      if (i > 0) add(`b:${words[i - 1]}_${word}`, 0.5);
      const padded = `^${word}$`;
      for (let j = 0; j + 3 <= padded.length; j++) add(`c:${padded.slice(j, j + 3)}`, 0.25);
    });

    const vector = new Array<number>(this.dimensions).fill(0);
    for (const [feature, { weight, count }] of features) {
      const h = fnv1a(feature);
      const index = h % this.dimensions;
      const sign = (h >>> 31) & 1 ? -1 : 1;
      vector[index] += sign * weight * (1 + Math.log(count));
    }

    const norm = Math.hypot(...vector);
    return norm === 0 ? vector : vector.map((v) => v / norm);
  }

  async embedDocuments(texts: string[]): Promise<EmbeddingBatch> {
    return { vectors: texts.map((t) => this.embed(t)), tokens: 0 };
  }

  async embedQuery(text: string): Promise<EmbeddingBatch> {
    return { vectors: [this.embed(text)], tokens: 0 };
  }
}
