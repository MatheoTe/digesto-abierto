import { z } from "zod";
import { postJson } from "./http";

export interface RerankResult {
  results: { index: number; score: number }[];
  tokens: number;
}

/** Cross-encoder style second stage: scores (query, passage) pairs jointly. */
export interface Reranker {
  readonly model: string;
  rerank(query: string, documents: string[], topK: number): Promise<RerankResult>;
}

const responseSchema = z.object({
  data: z.array(z.object({ index: z.number().int(), relevance_score: z.number() })),
  usage: z.object({ total_tokens: z.number().int() }).optional(),
});

export const VOYAGE_RERANK_URL = "https://api.voyageai.com/v1/rerank";

export class VoyageReranker implements Reranker {
  constructor(
    private readonly apiKey: string,
    readonly model = "rerank-3",
    private readonly fetchImpl?: typeof fetch,
  ) {}

  async rerank(query: string, documents: string[], topK: number): Promise<RerankResult> {
    if (documents.length === 0) return { results: [], tokens: 0 };
    const res = await postJson({
      provider: "voyage-rerank",
      url: VOYAGE_RERANK_URL,
      apiKey: this.apiKey,
      fetchImpl: this.fetchImpl,
      schema: responseSchema,
      body: { query, documents, model: this.model, top_k: topK, truncation: true },
    });
    return {
      results: res.data
        .map((d) => ({ index: d.index, score: d.relevance_score }))
        .sort((a, b) => b.score - a.score),
      tokens: res.usage?.total_tokens ?? 0,
    };
  }
}
