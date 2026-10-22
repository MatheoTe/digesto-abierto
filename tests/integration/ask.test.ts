import { EMBEDDING_DIMENSIONS } from "@/server/db/schema";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ABSTAIN_ANSWER } from "@/lib/citations";
import type { AskEvent } from "@/lib/ask-events";
import type { DbHandle } from "@/server/db/client";
import { traces } from "@/server/db/schema";
import { ProviderError } from "@/server/errors";
import { answerQuestion } from "@/server/generation/answer";
import type { Providers } from "@/server/providers";
import { LocalHashEmbeddingProvider } from "@/server/providers/embeddings/local-hash";
import { OfflineLlmProvider } from "@/server/providers/llm/offline";
import type { LlmProvider } from "@/server/providers/llm/types";
import { spentToday } from "@/server/repositories";
import { createTestDb, loadFixtureCorpus } from "./helpers";

let handle: DbHandle;
const embeddings = new LocalHashEmbeddingProvider(EMBEDDING_DIMENSIONS);
const offline: Providers = { llm: new OfflineLlmProvider(), embeddings, reranker: null, judge: null };

beforeAll(async () => {
  handle = await createTestDb();
  await loadFixtureCorpus(handle, embeddings);
});
afterAll(async () => {
  await handle.close();
});

async function ask(question: string, providers: Providers = offline) {
  const events: AskEvent[] = [];
  const outcome = await answerQuestion({ db: handle.db, providers }, { question, k: 6 }, (e) => events.push(e));
  return { outcome, events };
}

async function trace(id: string) {
  const [row] = await handle.db.select().from(traces).where(eq(traces.id, id));
  return row;
}

describe("answerQuestion (offline providers)", () => {
  it("streams sources and a cited answer, with the vigencia of each source, and persists a trace", async () => {
    const { outcome, events } = await ask("¿Cuántas horas de turno diario obligatorio tiene que cumplir un taxi?");

    const types = events.map((e) => e.type).filter((t) => t !== "stage");
    expect(types[0]).toBe("meta");
    expect(types[1]).toBe("sources");
    expect(types.at(-1)).toBe("done");
    const streamed = events.flatMap((e) => (e.type === "delta" ? [e.text] : [])).join("");
    expect(streamed).toBe(outcome.answer);
    expect(outcome.answerable).toBe(true);
    expect(outcome.answer).toContain("ocho (8) horas");

    const cited = outcome.sources[outcome.citations[0].index - 1];
    expect(cited).toMatchObject({ ordinanceNumber: 90001, label: "Art. 16º", inForce: true, laterAmendments: [90020] });
    expect(cited.textUrl).toContain("o90001");

    const row = await trace(outcome.traceId);
    expect(row).toMatchObject({ status: "ok", answerable: true, llmProvider: "offline", costUsd: 0 });
    expect(row.retrieval[0]).toMatchObject({ ordinanceNumber: expect.any(Number) });
  });

  it("names a repealed ordinance through its record card", async () => {
    const { outcome } = await ask("¿Sigue vigente la Ordenanza 90003?");
    expect(outcome.sources[0]).toMatchObject({ ordinanceNumber: 90003, kind: "record", inForce: false, repealedBy: 90004 });
  });

  it("abstains explicitly when the digest does not contain the answer", async () => {
    const { outcome, events } = await ask("¿Cuánto cuesta el estacionamiento medido en la Rambla?");
    expect(outcome.answer).toBe(ABSTAIN_ANSWER);
    expect(outcome.answerable).toBe(false);
    expect(outcome.citations).toEqual([]);
    expect(events.at(-1)).toMatchObject({ type: "done", answerable: false });
  });

  it("records failures as error traces and emits an error event", async () => {
    const broken: LlmProvider = {
      name: "anthropic",
      answerModel: "claude-sonnet-5-5",
      rewriteQuery: async (q) => ({ query: q, usage: null }),
      streamAnswer: async () => {
        throw new ProviderError("anthropic", "rate limited");
      },
    };
    const events: AskEvent[] = [];
    await expect(
      answerQuestion({ db: handle.db, providers: { ...offline, llm: broken } }, { question: "¿Turno diario de los taxis?", k: 4 }, (e) =>
        events.push(e),
      ),
    ).rejects.toBeInstanceOf(ProviderError);
    const meta = events[0] as Extract<AskEvent, { type: "meta" }>;
    expect(events.at(-1)).toEqual({ type: "error", error: { code: "PROVIDER_ERROR", message: "anthropic: rate limited" } });
    expect(await trace(meta.traceId)).toMatchObject({ status: "error", error: "anthropic: rate limited" });
  });

  it("costs real model usage, and the daily spend adds it up", async () => {
    const before = await spentToday(handle.db);
    const paid: LlmProvider = {
      name: "anthropic",
      answerModel: "claude-sonnet-5-5",
      rewriteQuery: async (q) => ({
        query: q,
        usage: { model: "claude-haiku-4-5-20251001", inputTokens: 100, outputTokens: 20, cacheReadTokens: 0, cacheWriteTokens: 0 },
      }),
      streamAnswer: async (_req, onDelta) => {
        onDelta("Ocho horas [1].");
        return {
          text: "Ocho horas [1].",
          refused: false,
          usage: { model: "claude-sonnet-5-5", inputTokens: 2000, outputTokens: 100, cacheReadTokens: 1000, cacheWriteTokens: 0 },
        };
      },
    };
    const { outcome } = await ask("¿Turno diario obligatorio de los taxis?", { ...offline, llm: paid });
    const row = await trace(outcome.traceId);
    // haiku: 100*1e-6 + 20*5e-6 ; sonnet: 2000*2e-6 + 100*10e-6 + 1000*0.2e-6
    expect(row.costUsd).toBeCloseTo(0.0002 + 0.004 + 0.001 + 0.0002, 6);
    expect(await spentToday(handle.db)).toBeCloseTo(before + row.costUsd!, 6);
  });
});
