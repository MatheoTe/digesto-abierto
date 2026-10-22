import { describe, expect, it, vi } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { ABSTAIN_ANSWER, extractCitations } from "@/lib/citations";
import { resetEnvCache, getEnv } from "@/server/config/env";
import { ProviderError } from "@/server/errors";
import type { SourcePassage } from "@/server/generation/prompt";
import { LocalHashEmbeddingProvider } from "@/server/providers/embeddings/local-hash";
import { VoyageEmbeddingProvider } from "@/server/providers/embeddings/voyage";
import { postJson } from "@/server/providers/http";
import { describeProviders, resolveProviders } from "@/server/providers";
import { AnthropicLlmProvider } from "@/server/providers/llm/anthropic";
import { OfflineLlmProvider, extractiveAnswer } from "@/server/providers/llm/offline";
import { VoyageReranker } from "@/server/providers/rerank";
import { z } from "zod";

const cosine = (a: number[], b: number[]) => a.reduce((s, v, i) => s + v * b[i], 0);

describe("LocalHashEmbeddingProvider", () => {
  const provider = new LocalHashEmbeddingProvider(1024);

  it("is deterministic, unit-length and the configured width", async () => {
    const [a] = (await provider.embedQuery("webhook retry schedule")).vectors;
    const [b] = (await provider.embedQuery("webhook retry schedule")).vectors;
    expect(a).toEqual(b);
    expect(a).toHaveLength(1024);
    expect(Math.hypot(...a)).toBeCloseTo(1, 6);
  });

  it("ranks lexically related text above unrelated text", async () => {
    const { vectors } = await provider.embedDocuments([
      "Failed deliveries are retried with exponential backoff.",
      "Parental leave lasts twenty weeks.",
    ]);
    const [q] = (await provider.embedQuery("how are failed deliveries retried?")).vectors;
    expect(cosine(q, vectors[0])).toBeGreaterThan(cosine(q, vectors[1]) + 0.2);
  });

  it("tolerates morphology through character trigrams", async () => {
    const [q] = (await provider.embedQuery("key rotation")).vectors;
    const { vectors } = await provider.embedDocuments(["keys are rotated every 90 days", "the office has plants"]);
    expect(cosine(q, vectors[0])).toBeGreaterThan(cosine(q, vectors[1]));
  });

  it("returns a zero vector for text without content terms", async () => {
    const [v] = (await provider.embedQuery("the of and")).vectors;
    expect(v.every((x) => x === 0)).toBe(true);
  });
});

function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" }, ...init });
}

describe("VoyageEmbeddingProvider", () => {
  it("sends input_type + output_dimension and reorders results by index", async () => {
    const fetchMock = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
      jsonResponse({
        data: [
          { embedding: [0, 1, 0, 0], index: 1 },
          { embedding: [1, 0, 0, 0], index: 0 },
        ],
        usage: { total_tokens: 12 },
      }),
    );
    const provider = new VoyageEmbeddingProvider("key", "voyage-4", 4, fetchMock as unknown as typeof fetch);
    const res = await provider.embedDocuments(["a", "b"]);

    expect(res.vectors).toEqual([
      [1, 0, 0, 0],
      [0, 1, 0, 0],
    ]);
    expect(res.tokens).toBe(12);
    expect(provider.model).toBe("voyage-4@4");
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(body).toEqual({ input: ["a", "b"], model: "voyage-4", input_type: "document", output_dimension: 4 });
    expect(new Headers(fetchMock.mock.calls[0][1]?.headers).get("authorization")).toBe("Bearer key");
  });

  it("rejects vectors with the wrong dimension", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ data: [{ embedding: [1, 2], index: 0 }] }));
    const provider = new VoyageEmbeddingProvider("key", "voyage-4", 4, fetchMock as unknown as typeof fetch);
    await expect(provider.embedQuery("q")).rejects.toBeInstanceOf(ProviderError);
  });
});

describe("postJson", () => {
  const schema = z.object({ ok: z.boolean() });

  it("retries 429 honouring Retry-After, then succeeds", async () => {
    const sleeps: number[] = [];
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("slow down", { status: 429, headers: { "retry-after": "2" } }))
      .mockResolvedValueOnce(jsonResponse({ ok: true }));
    const result = await postJson({
      provider: "test",
      url: "https://x.test",
      apiKey: "k",
      body: {},
      schema,
      fetchImpl: fetchMock,
      sleep: async (ms) => void sleeps.push(ms),
    });
    expect(result).toEqual({ ok: true });
    expect(sleeps).toEqual([2000]);
  });

  it("does not retry client errors and surfaces a typed error", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("bad key", { status: 401 }));
    await expect(
      postJson({ provider: "test", url: "https://x.test", apiKey: "k", body: {}, schema, fetchImpl: fetchMock }),
    ).rejects.toThrow(/test: HTTP 401: bad key/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("validates the response shape", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ nope: 1 }));
    await expect(
      postJson({ provider: "test", url: "https://x.test", apiKey: "k", body: {}, schema, fetchImpl: fetchMock }),
    ).rejects.toThrow(/unexpected response shape/);
  });
});

describe("VoyageReranker", () => {
  it("returns results sorted by relevance", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ data: [{ index: 0, relevance_score: 0.1 }, { index: 2, relevance_score: 0.9 }], usage: { total_tokens: 30 } }),
    );
    const reranker = new VoyageReranker("key", "rerank-3", fetchMock as unknown as typeof fetch);
    const res = await reranker.rerank("q", ["a", "b", "c"], 2);
    expect(res.results).toEqual([
      { index: 2, score: 0.9 },
      { index: 0, score: 0.1 },
    ]);
    expect(res.tokens).toBe(30);
  });
});

const sources: SourcePassage[] = [
  {
    index: 1,
    ordinanceNumber: 90001,
    sanctionedOn: null,
    inForce: true,
    repealedBy: null,
    textSource: "original",
    laterAmendments: [],
    kind: "article",
    label: null,
    headingPath: "Kestrel Relay API Reference > Rate limits",
    content:
      "The API enforces a limit of 600 requests per minute per workspace, with a burst allowance of 100 requests. Limits are tracked with a sliding window.",
  },
  {
    index: 2,
    ordinanceNumber: 90001,
    sanctionedOn: null,
    inForce: true,
    repealedBy: null,
    textSource: "original",
    laterAmendments: [],
    kind: "article",
    label: null,
    headingPath: "Employee Handbook > Time off",
    content: "Every employee receives 25 days of paid time off per calendar year.",
  },
];

describe("offline extractive answerer", () => {
  it("answers with the best supporting sentence and a valid citation", () => {
    const answer = extractiveAnswer("What is the API rate limit per workspace?", sources);
    expect(answer).toContain("600 requests per minute");
    expect(extractCitations(answer, sources.length).cited).toEqual([1]);
  });

  it("abstains when nothing in the sources covers the question", () => {
    expect(extractiveAnswer("Who is the CEO of Kestrel?", sources)).toBe(ABSTAIN_ANSWER);
    expect(extractiveAnswer("hello", [])).toBe(ABSTAIN_ANSWER);
  });

  it("streams deltas that reassemble into the final text", async () => {
    const llm = new OfflineLlmProvider();
    const deltas: string[] = [];
    const result = await llm.streamAnswer({ question: "How many days of paid time off?", sources }, (d) => deltas.push(d));
    expect(deltas.join("")).toBe(result.text);
    expect(result.text).toContain("[2]");
    expect(result.usage).toBeNull();
  });
});

describe("AnthropicLlmProvider", () => {
  it("rewrites queries with the fast model and reports usage", async () => {
    const create = vi.fn().mockResolvedValue({
      model: "claude-haiku-4-5-20251001",
      content: [{ type: "text", text: "paid time off days per year\nignored second line" }],
      usage: { input_tokens: 40, output_tokens: 8, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    });
    const client = { messages: { create } } as unknown as Anthropic;
    const llm = new AnthropicLlmProvider({ apiKey: "k", answerModel: "claude-sonnet-5-5", fastModel: "claude-haiku-4-5-20251001", effort: "low", client });

    const res = await llm.rewriteQuery("how many holidays do I get?");
    expect(res.query).toBe("paid time off days per year");
    expect(res.usage).toMatchObject({ model: "claude-haiku-4-5-20251001", inputTokens: 40, outputTokens: 8 });
    expect(create.mock.calls[0][0]).toMatchObject({ model: "claude-haiku-4-5-20251001", max_tokens: 200 });
  });
});

describe("resolveProviders", () => {
  it("falls back to fully offline providers when no keys are set", () => {
    const saved = { ...process.env };
    try {
      delete process.env.ANTHROPIC_API_KEY;
      delete process.env.VOYAGE_API_KEY;
      resetEnvCache();
      const providers = resolveProviders(getEnv());
      expect(describeProviders(providers)).toEqual({
        llm: "offline (extractive)",
        embeddings: "local-hash-v1@512",
        reranker: null,
        offline: true,
      });
      expect(providers.judge).toBeNull();
    } finally {
      process.env = saved;
      resetEnvCache();
    }
  });

  it("uses the real providers when keys exist", () => {
    const providers = resolveProviders({
      ...getEnv(),
      ANTHROPIC_API_KEY: "a",
      VOYAGE_API_KEY: "v",
      DIGESTO_LLM_PROVIDER: "auto",
      DIGESTO_EMBEDDINGS_PROVIDER: "auto",
      DIGESTO_RERANKER: "auto",
    });
    expect(providers.llm.name).toBe("anthropic");
    expect(providers.embeddings.model).toBe("voyage-4@512");
    expect(providers.reranker?.model).toBe("rerank-3");
    expect(providers.judge).not.toBeNull();
  });

  it("fails fast when a real provider is forced without its key", () => {
    expect(() =>
      resolveProviders({ ...getEnv(), ANTHROPIC_API_KEY: undefined, DIGESTO_LLM_PROVIDER: "anthropic" }),
    ).toThrow(/requires ANTHROPIC_API_KEY/);
  });
});

describe("offline answerer — stitched answers and follow-ups", () => {
  const passages: SourcePassage[] = [
    {
      index: 1,
      ordinanceNumber: 90001,
      sanctionedOn: null,
      inForce: true,
      repealedBy: null,
      textSource: "original",
      laterAmendments: [],
      kind: "article",
      label: null,
      headingPath: "API Reference > Delivery and retries",
      content:
        "Failed deliveries are retried with exponential backoff. A delivery is attempted at most 8 times in total before the event moves to the dead-letter queue. Dead-lettered events can be replayed manually from the dashboard.",
    },
    {
      index: 2,
      ordinanceNumber: 90001,
      sanctionedOn: null,
      inForce: true,
      repealedBy: null,
      textSource: "original",
      laterAmendments: [],
      kind: "article",
      label: null,
      headingPath: "Security Policy > Data retention",
      content: "If a delivery fails all 8 attempts, the event moves to the dead-letter queue and is kept there for 14 days.",
    },
  ];

  it("leads with the best sentence, continues it, and adds support from another passage", async () => {
    const { extractiveAnswer } = await import("@/server/providers/llm/offline");
    const answer = extractiveAnswer("How many delivery attempts happen before an event moves to the dead-letter queue?", passages);
    const [lead, support] = answer.split("\n\n");
    expect(lead).toMatch(/^A delivery is attempted at most 8 times.*\[1\] Dead-lettered events can be replayed.*\[1\]$/);
    expect(support).toContain("[2]");
    expect(extractCitations(answer, 2)).toEqual({ cited: [1, 2], invalid: [] });
  });

  it("rewrites short or pronoun-led follow-ups using the previous question", async () => {
    const { offlineStandaloneQuery } = await import("@/server/providers/llm/offline");
    const history = [{ question: "How much does the Growth plan cost?", answer: "49 USD [1]." }];
    expect(offlineStandaloneQuery("And the Scale plan?", history)).toBe("How much does the Growth plan cost? And the Scale plan?");
    expect(offlineStandaloneQuery("How long is parental leave in weeks for adoptive parents?", history)).toBe(
      "How long is parental leave in weeks for adoptive parents?",
    );
    expect(offlineStandaloneQuery("And the Scale plan?")).toBe("And the Scale plan?");
  });
});
