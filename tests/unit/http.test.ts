import { describe, expect, it } from "vitest";
import { RateLimitedError, ValidationError, NotFoundError, toErrorBody } from "@/server/errors";
import { TokenBucketRateLimiter, clientKey } from "@/server/http/rate-limit";
import { askRequestSchema, parseOrThrow } from "@/server/http/schemas";

describe("TokenBucketRateLimiter", () => {
  it("allows a burst up to capacity, then refuses with a retry hint", () => {
    const now = 0;
    const limiter = new TokenBucketRateLimiter(3, 60_000, () => now);
    expect([1, 2, 3].map(() => limiter.consume("ip").allowed)).toEqual([true, true, true]);
    const denied = limiter.consume("ip");
    expect(denied.allowed).toBe(false);
    expect(denied.retryAfterMs).toBe(20_000); // one token every 60s / 3
  });

  it("refills continuously over time", () => {
    let now = 0;
    const limiter = new TokenBucketRateLimiter(2, 60_000, () => now);
    limiter.consume("ip");
    limiter.consume("ip");
    expect(limiter.consume("ip").allowed).toBe(false);
    now += 30_000;
    expect(limiter.consume("ip").allowed).toBe(true);
    expect(limiter.consume("ip").allowed).toBe(false);
  });

  it("isolates keys and evicts the least recently used beyond maxKeys", () => {
    const now = 0;
    const limiter = new TokenBucketRateLimiter(1, 60_000, () => now, 2);
    expect(limiter.consume("a").allowed).toBe(true);
    expect(limiter.consume("b").allowed).toBe(true);
    expect(limiter.consume("a").allowed).toBe(false);
    limiter.consume("c"); // evicts "b" (least recently used)
    expect(limiter.consume("b").allowed).toBe(true);
  });

  it("derives the client key from proxy headers", () => {
    expect(clientKey(new Headers({ "x-forwarded-for": "1.2.3.4, 10.0.0.1" }))).toBe("1.2.3.4");
    expect(clientKey(new Headers({ "x-real-ip": "5.6.7.8" }))).toBe("5.6.7.8");
    expect(clientKey(new Headers())).toBe("anonymous");
  });
});

describe("request schemas", () => {
  it("trims and accepts a valid ask request", () => {
    expect(parseOrThrow(askRequestSchema, { question: "  ¿Se puede fumar en un bar?  " })).toEqual({
      question: "¿Se puede fumar en un bar?",
    });
  });

  it("rejects unknown fields and questions that are too short or too long", () => {
    expect(() => parseOrThrow(askRequestSchema, { question: "hi" })).toThrow(ValidationError);
    expect(() => parseOrThrow(askRequestSchema, { question: "x".repeat(601) })).toThrow(ValidationError);
    try {
      parseOrThrow(askRequestSchema, { question: "pregunta válida", k: 50 });
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(ValidationError);
    }
  });

  it("validates follow-up history turns", () => {
    const history = [{ question: "¿Y en Batán?", answer: "Lo mismo [1]." }];
    expect(parseOrThrow(askRequestSchema, { question: "¿Y los domingos?", history })).toEqual({ question: "¿Y los domingos?", history });
    expect(() => parseOrThrow(askRequestSchema, { question: "¿Y los domingos?", history: Array(7).fill(history[0]) })).toThrow(ValidationError);
  });
});

describe("error mapping", () => {
  it("maps typed errors to stable status codes and bodies", () => {
    expect(toErrorBody(new NotFoundError("Document", "x"))).toEqual({
      status: 404,
      headers: undefined,
      body: { error: { code: "NOT_FOUND", message: "Document x was not found" } },
    });
    const limited = toErrorBody(new RateLimitedError(12));
    expect(limited.status).toBe(429);
    expect(limited.headers).toEqual({ "Retry-After": "12" });
  });

  it("never leaks internal error messages", () => {
    expect(toErrorBody(new Error("password=hunter2"))).toEqual({
      status: 500,
      body: { error: { code: "INTERNAL", message: "Unexpected server error" } },
    });
  });
});
