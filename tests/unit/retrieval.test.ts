import { describe, expect, it } from "vitest";
import { buildTsQuery } from "@/server/retrieval/fts-query";
import { reciprocalRankFusion } from "@/server/retrieval/rrf";

describe("reciprocalRankFusion", () => {
  it("computes Σ 1/(k + rank) per item", () => {
    const fused = reciprocalRankFusion(
      [
        { name: "fts", ids: ["a", "b", "c"] },
        { name: "vector", ids: ["b", "a", "d"] },
      ],
      60,
    );
    const score = (id: string) => fused.find((f) => f.id === id)!.score;
    expect(score("a")).toBeCloseTo(1 / 61 + 1 / 62, 12);
    expect(score("b")).toBeCloseTo(1 / 62 + 1 / 61, 12);
    expect(score("c")).toBeCloseTo(1 / 63, 12);
    expect(score("d")).toBeCloseTo(1 / 63, 12);
  });

  it("prefers items found by both retrievers over a single first place", () => {
    const fused = reciprocalRankFusion([
      { name: "fts", ids: ["solo", "both"] },
      { name: "vector", ids: ["x", "y", "both"] },
    ]);
    expect(fused[0].id).toBe("both");
  });

  it("records per-list ranks and nulls for missing items", () => {
    const fused = reciprocalRankFusion([
      { name: "fts", ids: ["a"] },
      { name: "vector", ids: ["b", "a"] },
    ]);
    expect(fused.find((f) => f.id === "a")!.ranks).toEqual({ fts: 1, vector: 2 });
    expect(fused.find((f) => f.id === "b")!.ranks).toEqual({ fts: null, vector: 1 });
  });

  it("breaks ties deterministically by best rank, then id", () => {
    const fused = reciprocalRankFusion([
      { name: "fts", ids: ["c", "a"] },
      { name: "vector", ids: ["a", "c"] },
    ]);
    // a and c have identical scores and best ranks → alphabetical
    expect(fused.map((f) => f.id)).toEqual(["a", "c"]);
  });

  it("supports weights and ignores duplicate ids within a list", () => {
    const fused = reciprocalRankFusion(
      [
        { name: "fts", ids: ["a", "a", "b"], weight: 1 },
        { name: "vector", ids: ["b"], weight: 3 },
      ],
      0,
    );
    expect(fused[0]).toMatchObject({ id: "b", score: 1 / 3 + 3 });
    expect(fused[1]).toMatchObject({ id: "a", score: 1 });
  });

  it("returns an empty list for empty inputs", () => {
    expect(reciprocalRankFusion([{ name: "fts", ids: [] }])).toEqual([]);
  });
});

describe("buildTsQuery", () => {
  it("ORs content terms and drops stopwords", () => {
    expect(buildTsQuery("How long are dead-lettered events kept?")).toBe("dead-lettered | events | kept");
  });

  it("keeps identifiers intact and cannot be used to inject operators", () => {
    expect(buildTsQuery("error KR-1029 & !(drop) | 99.95%")).toBe("error | kr-1029 | drop | 99.95");
  });

  it("returns null when nothing searchable remains", () => {
    expect(buildTsQuery("what is the")).toBeNull();
    expect(buildTsQuery("?!")).toBeNull();
  });
});
