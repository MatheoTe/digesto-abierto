import { describe, expect, it } from "vitest";
import { llmCostUsd, tokenCostUsd } from "@/server/observability/pricing";

describe("pricing", () => {
  it("prices Sonnet usage including cache reads and writes", () => {
    const cost = llmCostUsd({
      model: "claude-sonnet-5-5",
      inputTokens: 1_000_000,
      outputTokens: 100_000,
      cacheReadTokens: 1_000_000,
      cacheWriteTokens: 0,
    });
    expect(cost).toBeCloseTo(2 + 1 + 0.2, 6);
  });

  it("normalises dated snapshot ids", () => {
    expect(
      llmCostUsd({ model: "claude-haiku-4-5-20251001", inputTokens: 1000, outputTokens: 1000, cacheReadTokens: 0, cacheWriteTokens: 0 }),
    ).toBeCloseTo(0.006, 9);
  });

  it("returns null for unknown models instead of claiming they are free", () => {
    expect(llmCostUsd({ model: "mystery", inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 })).toBeNull();
    expect(tokenCostUsd("mystery-embed", 10)).toBeNull();
  });

  it("prices embeddings per token and treats local models as free", () => {
    expect(tokenCostUsd("voyage-4@1024", 1_000_000)).toBeCloseTo(0.06, 9);
    expect(tokenCostUsd("local-hash-v1@1024", 5000)).toBe(0);
  });
});
