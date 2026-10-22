import { z } from "zod";
import { ProviderError } from "../../errors";
import { postJson } from "../http";
import type { EmbeddingBatch, EmbeddingProvider } from "./types";

const responseSchema = z.object({
  data: z.array(z.object({ embedding: z.array(z.number()), index: z.number().int() })),
  usage: z.object({ total_tokens: z.number().int() }).optional(),
});

export const VOYAGE_EMBEDDINGS_URL = "https://api.voyageai.com/v1/embeddings";
const BATCH_SIZE = 128;

export class VoyageEmbeddingProvider implements EmbeddingProvider {
  readonly kind = "remote" as const;
  readonly model: string;

  constructor(
    private readonly apiKey: string,
    private readonly modelName = "voyage-4",
    readonly dimensions = 1024,
    private readonly fetchImpl?: typeof fetch,
  ) {
    this.model = `${modelName}@${dimensions}`;
  }

  private async call(texts: string[], inputType: "document" | "query"): Promise<EmbeddingBatch> {
    const vectors: number[][] = [];
    let tokens = 0;
    for (let i = 0; i < texts.length; i += BATCH_SIZE) {
      const batch = texts.slice(i, i + BATCH_SIZE);
      const res = await postJson({
        provider: "voyage",
        url: VOYAGE_EMBEDDINGS_URL,
        apiKey: this.apiKey,
        fetchImpl: this.fetchImpl,
        schema: responseSchema,
        body: { input: batch, model: this.modelName, input_type: inputType, output_dimension: this.dimensions },
      });
      // The API documents ordered output, but sort by index rather than trust it.
      const ordered = [...res.data].sort((a, b) => a.index - b.index).map((d) => d.embedding);
      if (ordered.length !== batch.length || ordered.some((v) => v.length !== this.dimensions)) {
        throw new ProviderError("voyage", `returned ${ordered.length} vectors for ${batch.length} inputs (dim ${ordered[0]?.length})`);
      }
      vectors.push(...ordered);
      tokens += res.usage?.total_tokens ?? 0;
    }
    return { vectors, tokens };
  }

  embedDocuments(texts: string[]): Promise<EmbeddingBatch> {
    return this.call(texts, "document");
  }

  embedQuery(text: string): Promise<EmbeddingBatch> {
    return this.call([text], "query");
  }
}
