import { EMBEDDING_DIMENSIONS } from "@/server/db/schema";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DbHandle } from "@/server/db/client";
import { LocalHashEmbeddingProvider } from "@/server/providers/embeddings/local-hash";
import type { Reranker } from "@/server/providers/rerank";
import { retrieve } from "@/server/retrieval/hybrid";
import { createTestDb, loadFixtureCorpus } from "./helpers";

let handle: DbHandle;
const embeddings = new LocalHashEmbeddingProvider(EMBEDDING_DIMENSIONS);

beforeAll(async () => {
  handle = await createTestDb();
  await loadFixtureCorpus(handle, embeddings);
});
afterAll(async () => {
  await handle.close();
});

describe("hybrid retrieval over the fixture digest", () => {
  it("finds the article in Spanish, ignoring accents and stemming plurals", async () => {
    const res = await retrieve({ db: handle.db, embeddings }, "turno diario obligatorio taxis horas duracion", { k: 4, mode: "fts" });
    expect(res.chunks[0]).toMatchObject({ ordinanceNumber: 90001, label: "Art. 16º", kind: "article", ftsRank: 1, vectorRank: null });
    expect(res.chunks[0].headingPath).toBe("II - SERVICIO OBLIGATORIO");
  });

  it("carries the ordinance's vigencia with every chunk", async () => {
    const res = await retrieve({ db: handle.db, embeddings }, "turno diario taxi", { k: 4 });
    const article = res.chunks.find((c) => c.label === "Art. 16º")!;
    expect(article).toMatchObject({ inForce: true, textSource: "actualizado", laterAmendments: [90020] });
  });

  it("never returns text of a repealed ordinance from a general search", async () => {
    const res = await retrieve({ db: handle.db, embeddings }, "fumar locales gastronomicos cerrados", { k: 8 });
    expect(res.chunks.length).toBeGreaterThan(0);
    expect(res.chunks.every((c) => c.ordinanceNumber !== 90003)).toBe(true);
    expect(res.chunks[0].ordinanceNumber).toBe(90004);
  });

  it("includes the record card of an ordinance named by number, even when repealed", async () => {
    const res = await retrieve({ db: handle.db, embeddings }, "sigue vigente ordenanza 90003", { k: 4, ordinanceNumbers: [90003] });
    expect(res.chunks[0]).toMatchObject({ ordinanceNumber: 90003, kind: "record", inForce: false, repealedBy: 90004 });
    expect(res.chunks[0].content).toContain("abrogada por la Ordenanza 90004");
  });

  it("keeps a named ordinance's record card even when the reranker drops it", async () => {
    const lastFirst: Reranker = {
      model: "reverse-test",
      async rerank(_q, docs, topK) {
        return { results: docs.map((_, i) => ({ index: docs.length - 1 - i, score: 1 - i / 10 })).slice(0, topK), tokens: 3 };
      },
    };
    const res = await retrieve({ db: handle.db, embeddings, reranker: lastFirst }, "taxi botón antipánico ordenanza 90001", {
      k: 2,
      ordinanceNumbers: [90001],
    });
    expect(res.rerankTokens).toBe(3);
    expect(res.chunks.some((c) => c.kind === "record" && c.ordinanceNumber === 90001)).toBe(true);
  });

  it("fuses both retrievers with non-increasing scores", async () => {
    const res = await retrieve({ db: handle.db, embeddings }, "botón antipánico en los taxis", { k: 4 });
    expect(res.chunks[0].ordinanceNumber).toBe(90020);
    expect(res.chunks[0].ftsRank).not.toBeNull();
    expect(res.chunks[0].vectorRank).not.toBeNull();
    const scores = res.chunks.map((c) => c.fusedScore);
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);
  });

  it("returns nothing for a query with no searchable terms", async () => {
    const res = await retrieve({ db: handle.db, embeddings }, "qué es el", { k: 5, mode: "fts" });
    expect(res.chunks).toEqual([]);
  });
});
