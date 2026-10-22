export interface EmbeddingBatch {
  vectors: number[][];
  /** Billed tokens as reported by the provider (0 for local providers). */
  tokens: number;
}

/**
 * Anything that turns text into fixed-width vectors. Documents and queries
 * are embedded through separate methods because asymmetric models (Voyage)
 * encode them differently.
 */
export interface EmbeddingProvider {
  /** Stable identifier persisted next to every vector, e.g. "voyage-4@1024". */
  readonly model: string;
  readonly dimensions: number;
  readonly kind: "remote" | "local";
  embedDocuments(texts: string[]): Promise<EmbeddingBatch>;
  embedQuery(text: string): Promise<EmbeddingBatch>;
}
