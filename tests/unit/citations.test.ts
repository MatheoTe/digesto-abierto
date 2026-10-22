import { describe, expect, it } from "vitest";
import { ABSTAIN_ANSWER, extractCitations, isAbstention, segmentAnswer } from "@/lib/citations";

describe("extractCitations", () => {
  it("collects single, grouped and ranged markers in order of appearance", () => {
    const text = "Retries back off [2]. Signatures use HMAC [1, 3]. Plans differ [4-5]. Again [2].";
    expect(extractCitations(text, 5)).toEqual({ cited: [2, 1, 3, 4, 5], invalid: [] });
  });

  it("reports indices outside the provided sources as invalid", () => {
    expect(extractCitations("Claim [1]. Hallucinated [9]. Zero [0].", 3)).toEqual({ cited: [1], invalid: [9, 0] });
  });

  it("ignores bracketed text that is not a citation", () => {
    expect(extractCitations("Error [KR-1029] and a [link](x) and [2025]", 3)).toEqual({ cited: [], invalid: [] });
  });
});

describe("segmentAnswer", () => {
  it("splits text and citation chips", () => {
    expect(segmentAnswer("A [1]. B [2;3]", 3)).toEqual([
      { type: "text", text: "A " },
      { type: "cite", indices: [1] },
      { type: "text", text: ". B " },
      { type: "cite", indices: [2, 3] },
    ]);
  });

  it("leaves markers for unknown sources as plain text", () => {
    expect(segmentAnswer("Fact [4].", 3)).toEqual([{ type: "text", text: "Fact [4]." }]);
  });

  it("handles partially streamed markers gracefully", () => {
    expect(segmentAnswer("Fact [1", 3)).toEqual([{ type: "text", text: "Fact [1" }]);
  });
});

describe("isAbstention", () => {
  it("recognises the abstention sentence and close variants", () => {
    expect(isAbstention(ABSTAIN_ANSWER)).toBe(true);
    expect(isAbstention("  No encontre esto en las ordenanzas vigentes. Habría que buscar en decretos.")).toBe(true);
    expect(isAbstention("No encontré nada sobre eso [1].")).toBe(false);
    expect(isAbstention("El turno es de ocho horas [1].")).toBe(false);
  });
});

describe("toCitationMarkdown", () => {
  it("turns valid markers into cite links and records the claim each one supports", async () => {
    const { toCitationMarkdown } = await import("@/lib/citations");
    const { markdown, claims } = toCitationMarkdown("Intro text. Retries back off [1]. Keys rotate [2, 3].\n- Item fact [1]", 3);
    expect(markdown).toBe(
      "Intro text. Retries back off [1](#cite-1-0). Keys rotate [2](#cite-2-1)[3](#cite-3-2).\n- Item fact [1](#cite-1-3)",
    );
    expect(claims).toEqual(["Retries back off", "Keys rotate", "Keys rotate", "Item fact"]);
  });

  it("leaves invalid markers as plain text", async () => {
    const { toCitationMarkdown } = await import("@/lib/citations");
    expect(toCitationMarkdown("Fact [9].", 2)).toEqual({ markdown: "Fact [9].", claims: [] });
  });
});

describe("bestSupportingRange", () => {
  it("prefers an exact verbatim match, then the sentence with most overlapping terms", async () => {
    const { bestSupportingRange } = await import("@/lib/highlight");
    const content = "Failed deliveries are retried. A delivery is attempted at most 8 times. Keys rotate yearly.";
    const exact = bestSupportingRange(content, "A delivery is attempted at most 8 times. [1]")!;
    expect(content.slice(exact.start, exact.end)).toBe("A delivery is attempted at most 8 times");
    const fuzzy = bestSupportingRange(content, "Relay tries each delivery up to 8 times")!;
    expect(content.slice(fuzzy.start, fuzzy.end)).toBe("A delivery is attempted at most 8 times.");
    expect(bestSupportingRange(content, "Parental leave is long")).toBeNull();
  });
});
