import type { z } from "zod";
import { ProviderError } from "../errors";

export interface JsonRequest<T> {
  provider: string;
  url: string;
  apiKey: string;
  body: unknown;
  schema: z.ZodType<T>;
  timeoutMs?: number;
  maxRetries?: number;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

const RETRYABLE = new Set([408, 409, 429, 500, 502, 503, 504]);
const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * POST JSON with a timeout, bounded exponential backoff on retryable statuses
 * (honouring Retry-After) and schema validation of the response. Provider
 * responses are untrusted input like any other.
 */
export async function postJson<T>(req: JsonRequest<T>): Promise<T> {
  const { provider, url, apiKey, body, schema, timeoutMs = 30_000, maxRetries = 2 } = req;
  const fetchImpl = req.fetchImpl ?? fetch;
  const sleep = req.sleep ?? defaultSleep;

  for (let attempt = 0; ; attempt++) {
    let response: Response;
    try {
      response = await fetchImpl(url, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      if (attempt < maxRetries) {
        await sleep(500 * 2 ** attempt);
        continue;
      }
      throw new ProviderError(provider, "network error", err);
    }

    if (response.ok) {
      const parsed = schema.safeParse(await response.json());
      if (!parsed.success) throw new ProviderError(provider, "unexpected response shape", parsed.error);
      return parsed.data;
    }

    if (RETRYABLE.has(response.status) && attempt < maxRetries) {
      const retryAfter = Number(response.headers.get("retry-after"));
      await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 500 * 2 ** attempt);
      continue;
    }

    const detail = (await response.text().catch(() => "")).slice(0, 300);
    throw new ProviderError(provider, `HTTP ${response.status}${detail ? `: ${detail}` : ""}`);
  }
}
