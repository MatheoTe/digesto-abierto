export interface RateLimitDecision {
  allowed: boolean;
  remaining: number;
  /** Milliseconds until one more request would be allowed (0 when allowed). */
  retryAfterMs: number;
}

export interface RateLimiter {
  consume(key: string): RateLimitDecision;
}

interface Bucket {
  tokens: number;
  updatedAt: number;
}

/**
 * In-memory token bucket: `capacity` requests of burst, refilled continuously
 * at `capacity / windowMs`. Good for a single instance; a multi-instance
 * deployment swaps in a Redis/Upstash implementation of the same interface.
 * Idle buckets are evicted so memory stays bounded under key churn.
 */
export class TokenBucketRateLimiter implements RateLimiter {
  private readonly buckets = new Map<string, Bucket>();
  private readonly refillPerMs: number;

  constructor(
    private readonly capacity: number,
    windowMs = 60_000,
    private readonly now: () => number = Date.now,
    private readonly maxKeys = 10_000,
  ) {
    if (capacity < 1) throw new Error("capacity must be at least 1");
    this.refillPerMs = capacity / windowMs;
  }

  consume(key: string): RateLimitDecision {
    const now = this.now();
    const bucket = this.buckets.get(key) ?? { tokens: this.capacity, updatedAt: now };
    bucket.tokens = Math.min(this.capacity, bucket.tokens + (now - bucket.updatedAt) * this.refillPerMs);
    bucket.updatedAt = now;

    // Re-insert to keep Map iteration order ≈ LRU.
    this.buckets.delete(key);
    this.buckets.set(key, bucket);
    if (this.buckets.size > this.maxKeys) this.buckets.delete(this.buckets.keys().next().value!);

    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;
      return { allowed: true, remaining: Math.floor(bucket.tokens), retryAfterMs: 0 };
    }
    return { allowed: false, remaining: 0, retryAfterMs: Math.ceil((1 - bucket.tokens) / this.refillPerMs) };
  }
}

/** Best-effort client identity behind a proxy. */
export function clientKey(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || headers.get("x-real-ip") || "anonymous";
}
