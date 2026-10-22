import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { AskEvent } from "@/lib/ask-events";
import type { DbHandle } from "@/server/db/client";
import { traces } from "@/server/db/schema";
import { LocalHashEmbeddingProvider } from "@/server/providers/embeddings/local-hash";
import { createTestDb, loadFixtureCorpus } from "./helpers";

vi.mock("next/server", () => ({ connection: async () => {} }));

let handle: DbHandle;

beforeAll(async () => {
  process.env.DIGESTO_RATE_LIMIT_PER_MINUTE = "1000";
  process.env.DIGESTO_DAILY_BUDGET_USD = "0";
  handle = await createTestDb();
  await loadFixtureCorpus(handle, new LocalHashEmbeddingProvider(1024));
  // Route handlers use the process-wide DB singleton: point it at the test database.
  (globalThis as { __digestoDb?: Promise<DbHandle> }).__digestoDb = Promise.resolve(handle);
});
afterAll(async () => {
  await handle.close();
});

async function readEvents(res: Response): Promise<AskEvent[]> {
  return (await res.text())
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as AskEvent);
}

const askRequest = (question: string, ip = "1.1.1.1") =>
  new Request("http://test/api/ask", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ip },
    body: JSON.stringify({ question }),
  });

async function freshAskRoute(env: Record<string, string>) {
  vi.resetModules();
  Object.assign(process.env, env);
  delete (globalThis as { __digestoAskLimiter?: unknown }).__digestoAskLimiter;
  (await import("@/server/config/env")).resetEnvCache();
  return (await import("@/app/api/ask/route")).POST;
}

describe("HTTP API", () => {
  it("streams an NDJSON answer for a question", async () => {
    const { POST: ask } = await import("@/app/api/ask/route");
    const res = await ask(askRequest("¿Cuántas horas de turno diario tiene un taxi?"));
    expect(res.headers.get("content-type")).toContain("application/x-ndjson");
    const done = (await readEvents(res)).at(-1);
    expect(done).toMatchObject({ type: "done", answerable: true });
  });

  it("serves an ordinance with its articles, and 404 / 400 otherwise", async () => {
    const { GET } = await import("@/app/api/ordenanzas/[numero]/route");
    const ok = await GET(new Request("http://test"), { params: Promise.resolve({ numero: "90001" }) });
    const body = await ok.json();
    expect(body.ordinance).toMatchObject({ number: 90001, inForce: true, laterAmendments: [90020] });
    expect(body.ordinance.chunks.map((c: { label: string }) => c.label)).toEqual(["Art. 1º", "Art. 16º", "Art. 23º"]);
    expect((await GET(new Request("http://test"), { params: Promise.resolve({ numero: "12345" }) })).status).toBe(404);
    expect((await GET(new Request("http://test"), { params: Promise.resolve({ numero: "abc" }) })).status).toBe(400);
  });

  it("returns typed 400 errors for invalid input", async () => {
    const { POST: ask } = await import("@/app/api/ask/route");
    const res = await ask(new Request("http://test/api/ask", { method: "POST", body: JSON.stringify({ question: "" }) }));
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("VALIDATION_FAILED");
    const bad = await ask(new Request("http://test/api/ask", { method: "POST", body: "{not json" }));
    expect(bad.status).toBe(400);
  });

  it("stops answering for the day once the spend cap is reached", async () => {
    await handle.db.insert(traces).values({
      question: "pregunta cara",
      status: "ok",
      llmProvider: "anthropic",
      embeddingModel: "voyage-4@1024",
      timings: { rewriteMs: 0, embedMs: 0, ftsMs: 0, vectorMs: 0, fuseMs: 0, rerankMs: 0, retrievalMs: 0, ttftMs: null, generationMs: 0, totalMs: 0 },
      retrieval: [],
      citations: [],
      usage: [],
      costUsd: 0.5,
      totalMs: 0,
    });
    const ask = await freshAskRoute({ DIGESTO_DAILY_BUDGET_USD: "0.4" });
    const res = await ask(askRequest("¿Turno diario de los taxis?"));
    expect(res.status).toBe(429);
    expect((await res.json()).error.code).toBe("BUDGET_EXCEEDED");
    process.env.DIGESTO_DAILY_BUDGET_USD = "0";
  });

  it("rate limits /api/ask with 429 and Retry-After", async () => {
    const ask = await freshAskRoute({ DIGESTO_RATE_LIMIT_PER_MINUTE: "2", DIGESTO_DAILY_BUDGET_USD: "0" });
    const call = () => ask(new Request("http://test/api/ask", { method: "POST", headers: { "x-forwarded-for": "9.9.9.9" }, body: JSON.stringify({ question: "x" }) }));
    expect((await call()).status).toBe(400); // consumes a token, then fails validation
    expect((await call()).status).toBe(400);
    const limited = await call();
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);
  });
});
