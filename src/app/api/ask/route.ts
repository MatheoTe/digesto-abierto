import type { AskEvent } from "@/lib/ask-events";
import { getEnv } from "@/server/config/env";
import { getAskRateLimiter } from "@/server/context";
import { getDb } from "@/server/db/client";
import { BudgetExceededError, RateLimitedError } from "@/server/errors";
import { answerQuestion } from "@/server/generation/answer";
import { clientKey } from "@/server/http/rate-limit";
import { withErrors } from "@/server/http/route";
import { askRequestSchema, parseOrThrow, readJson } from "@/server/http/schemas";
import { getProviders } from "@/server/providers";
import { spentToday } from "@/server/repositories";

export const maxDuration = 60;

/**
 * POST /api/ask — streams NDJSON events (see src/lib/ask-events.ts).
 * Validation and rate limiting happen before the stream opens, so those
 * failures are ordinary JSON errors with proper status codes.
 */
export const POST = withErrors(async (request: Request) => {
  const decision = getAskRateLimiter().consume(clientKey(request.headers));
  if (!decision.allowed) throw new RateLimitedError(Math.ceil(decision.retryAfterMs / 1000));

  const body = parseOrThrow(askRequestSchema, await readJson(request));
  const db = await getDb();
  const budget = getEnv().DIGESTO_DAILY_BUDGET_USD;
  if (budget > 0 && (await spentToday(db)) >= budget) throw new BudgetExceededError();
  const providers = getProviders();
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (event: AskEvent) => controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      try {
        await answerQuestion(
          { db, providers },
          {
            question: body.question,
            k: getEnv().DIGESTO_RETRIEVAL_K,
            history: body.history,
          },
          emit,
          request.signal,
        );
      } catch {
        // already reported to the client as an `error` event and persisted as a trace
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-store",
      "x-ratelimit-remaining": String(decision.remaining),
    },
  });
});
