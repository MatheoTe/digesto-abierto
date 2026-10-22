import { getEnv, type Env } from "../config/env";
import { EMBEDDING_DIMENSIONS } from "../db/schema";
import { LocalHashEmbeddingProvider } from "./embeddings/local-hash";
import type { EmbeddingProvider } from "./embeddings/types";
import { VoyageEmbeddingProvider } from "./embeddings/voyage";
import { AnthropicFaithfulnessJudge, AnthropicLlmProvider } from "./llm/anthropic";
import { OfflineLlmProvider } from "./llm/offline";
import type { FaithfulnessJudge, LlmProvider } from "./llm/types";
import { VoyageReranker, type Reranker } from "./rerank";

export interface Providers {
  llm: LlmProvider;
  embeddings: EmbeddingProvider;
  reranker: Reranker | null;
  judge: FaithfulnessJudge | null;
}

export interface ProviderMode {
  llm: string;
  embeddings: string;
  reranker: string | null;
  offline: boolean;
}

function pick<T extends string>(setting: "auto" | T, hasKey: boolean, real: T, fallback: T): T {
  if (setting === "auto") return hasKey ? real : fallback;
  return setting;
}

/** Resolve providers from configuration. Explicitly requesting a real provider without its key is a config error. */
export function resolveProviders(env: Env = getEnv()): Providers {
  const llmChoice = pick(env.DIGESTO_LLM_PROVIDER, !!env.ANTHROPIC_API_KEY, "anthropic", "offline");
  const embChoice = pick(env.DIGESTO_EMBEDDINGS_PROVIDER, !!env.VOYAGE_API_KEY, "voyage", "local");
  const rerankChoice = pick(env.DIGESTO_RERANKER, !!env.VOYAGE_API_KEY, "voyage", "none");

  if (llmChoice === "anthropic" && !env.ANTHROPIC_API_KEY) throw new Error("DIGESTO_LLM_PROVIDER=anthropic requires ANTHROPIC_API_KEY");
  if ((embChoice === "voyage" || rerankChoice === "voyage") && !env.VOYAGE_API_KEY) {
    throw new Error("Voyage embeddings/reranking require VOYAGE_API_KEY");
  }

  const llm: LlmProvider =
    llmChoice === "anthropic"
      ? new AnthropicLlmProvider({
          apiKey: env.ANTHROPIC_API_KEY!,
          answerModel: env.DIGESTO_ANSWER_MODEL,
          fastModel: env.DIGESTO_FAST_MODEL,
          effort: env.DIGESTO_ANSWER_EFFORT,
        })
      : new OfflineLlmProvider();

  const embeddings: EmbeddingProvider =
    embChoice === "voyage"
      ? new VoyageEmbeddingProvider(env.VOYAGE_API_KEY!, env.DIGESTO_VOYAGE_EMBED_MODEL, EMBEDDING_DIMENSIONS)
      : new LocalHashEmbeddingProvider(EMBEDDING_DIMENSIONS);

  const reranker = rerankChoice === "voyage" ? new VoyageReranker(env.VOYAGE_API_KEY!, env.DIGESTO_VOYAGE_RERANK_MODEL) : null;
  const judge = env.ANTHROPIC_API_KEY ? new AnthropicFaithfulnessJudge(env.ANTHROPIC_API_KEY, env.DIGESTO_FAST_MODEL) : null;

  return { llm, embeddings, reranker, judge };
}

export function describeProviders(p: Providers): ProviderMode {
  return {
    llm: p.llm.name === "anthropic" ? p.llm.answerModel : "offline (extractive)",
    embeddings: p.embeddings.model,
    reranker: p.reranker?.model ?? null,
    offline: p.llm.name === "offline" && p.embeddings.kind === "local",
  };
}

let cached: Providers | undefined;
export function getProviders(): Providers {
  cached ??= resolveProviders();
  return cached;
}
