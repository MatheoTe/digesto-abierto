import { getEnv } from "./config/env";
import { TokenBucketRateLimiter, type RateLimiter } from "./http/rate-limit";

const globalForLimiter = globalThis as unknown as { __digestoAskLimiter?: RateLimiter };

/** Per-client limiter for /api/ask (per instance; the daily budget is the global guard). */
export function getAskRateLimiter(): RateLimiter {
  globalForLimiter.__digestoAskLimiter ??= new TokenBucketRateLimiter(getEnv().DIGESTO_RATE_LIMIT_PER_MINUTE);
  return globalForLimiter.__digestoAskLimiter;
}
