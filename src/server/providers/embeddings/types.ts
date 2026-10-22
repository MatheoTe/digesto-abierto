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
  /** "none": the deployment searches by words only; retrieval skips the vector stage. */
  readonly kind: "remote" | "local" | "none";
  embedDocuments(texts: string[]): Promise<EmbeddingBatch>;
  embedQuery(text: string): Promise<EmbeddingBatch>;
}

/** No vectors at all: every call returns nothing, and retrieval knows to skip the vector stage. */
export class NoEmbeddingProvider implements EmbeddingProvider {
  readonly kind = "none" as const;
  readonly model = "none";
  readonly dimensions = 0;
  async embedDocuments(): Promise<EmbeddingBatch> {
    return { vectors: [], tokens: 0 };
  }
  async embedQuery(): Promise<EmbeddingBatch> {
    return { vectors: [], tokens: 0 };
  }
}
