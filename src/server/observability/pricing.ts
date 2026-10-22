import type { LlmUsage } from "../providers/llm/types";

/** USD per million tokens. Cache writes use the 5-minute TTL rate (1.25× input). */
interface ModelPrice {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

const LLM_PRICES: Record<string, ModelPrice> = {
  "claude-sonnet-5-5": { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
  "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
  "claude-haiku-4-5": { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 },
};

/** USD per million tokens for embedding / reranking models. */
const TOKEN_PRICES: Record<string, number> = {
  "voyage-4": 0.06,
  "voyage-4-lite": 0.02,
  "voyage-4-large": 0.12,
  "rerank-3": 0.05,
  "rerank-3-lite": 0.02,
};

/** Model ids may carry a date snapshot ("claude-haiku-4-5-20251001") or a dimension suffix ("voyage-4@1024"). */
function baseModel(model: string): string {
  return model.replace(/@.*$/, "").replace(/-\d{8}$/, "");
}

/** Returns null for unknown models rather than pretending they are free. */
export function llmCostUsd(usage: LlmUsage): number | null {
  const price = LLM_PRICES[baseModel(usage.model)];
  if (!price) return null;
  const perToken = (rate: number) => rate / 1_000_000;
  return (
    usage.inputTokens * perToken(price.input) +
    usage.outputTokens * perToken(price.output) +
    usage.cacheReadTokens * perToken(price.cacheRead) +
    usage.cacheWriteTokens * perToken(price.cacheWrite)
  );
}

export function tokenCostUsd(model: string, tokens: number): number | null {
  if (model.startsWith("local-") || tokens === 0) return 0;
  const price = TOKEN_PRICES[baseModel(model)];
  return price === undefined ? null : (tokens * price) / 1_000_000;
}
