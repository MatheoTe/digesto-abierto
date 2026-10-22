import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { ProviderError } from "../../errors";
import {
  ANSWER_SYSTEM_PROMPT,
  REWRITE_SYSTEM_PROMPT,
  buildAnswerUserMessage,
  buildRewriteUserMessage,
  type SourcePassage,
} from "../../generation/prompt";
import type { HistoryTurn } from "@/lib/ask-events";
import type {
  AnswerRequest,
  AnswerResult,
  FaithfulnessJudge,
  FaithfulnessVerdict,
  LlmProvider,
  LlmUsage,
} from "./types";

interface UsageLike {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
}

export function toUsage(model: string, usage: UsageLike): LlmUsage {
  return {
    model,
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    cacheReadTokens: usage.cache_read_input_tokens ?? 0,
    cacheWriteTokens: usage.cache_creation_input_tokens ?? 0,
  };
}

function wrap(err: unknown): never {
  if (err instanceof Anthropic.RateLimitError) throw new ProviderError("anthropic", "rate limited", err);
  if (err instanceof Anthropic.AuthenticationError) throw new ProviderError("anthropic", "invalid API key", err);
  if (err instanceof Anthropic.APIError) throw new ProviderError("anthropic", `API error ${err.status ?? ""}`.trim(), err);
  throw err;
}

export interface AnthropicProviderOptions {
  apiKey: string;
  answerModel: string;
  fastModel: string;
  effort: "low" | "medium" | "high";
  client?: Anthropic;
}

/**
 * Claude-backed provider.
 *  - Query rewriting runs on the fast model (cheap, short output).
 *  - Answers stream from the answer model. The system prompt is frozen and
 *    marked with cache_control, so repeated questions reuse the cached prefix;
 *    the retrieved passages vary per request and sit after the breakpoint.
 *  - Server-side refusal fallbacks are enabled so a safety-classifier decline
 *    is retried on a fallback model instead of failing the request.
 */
export class AnthropicLlmProvider implements LlmProvider {
  readonly name = "anthropic" as const;
  readonly answerModel: string;
  private readonly client: Anthropic;

  constructor(private readonly options: AnthropicProviderOptions) {
    this.answerModel = options.answerModel;
    this.client = options.client ?? new Anthropic({ apiKey: options.apiKey, maxRetries: 2, timeout: 60_000 });
  }

  async rewriteQuery(question: string, history?: HistoryTurn[]): Promise<{ query: string; usage: LlmUsage | null }> {
    try {
      const res = await this.client.messages.create({
        model: this.options.fastModel,
        max_tokens: 200,
        system: REWRITE_SYSTEM_PROMPT,
        messages: [{ role: "user", content: buildRewriteUserMessage(question, history) }],
      });
      const text = res.content
        .flatMap((b) => (b.type === "text" ? [b.text] : []))
        .join(" ")
        .split("\n")[0]
        .trim();
      return { query: text || question, usage: toUsage(res.model, res.usage) };
    } catch (err) {
      wrap(err);
    }
  }

  async streamAnswer(request: AnswerRequest, onDelta: (text: string) => void): Promise<AnswerResult> {
    try {
      const stream = this.client.beta.messages.stream(
        {
          model: this.options.answerModel,
          max_tokens: 8000,
          betas: ["server-side-fallback-2026-07-01"],
          fallbacks: "default",
          output_config: { effort: this.options.effort },
          system: [{ type: "text", text: ANSWER_SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
          messages: [{ role: "user", content: buildAnswerUserMessage(request.question, request.sources, request.history) }],
        },
        { signal: request.signal },
      );
      stream.on("text", (delta) => onDelta(delta));
      const final = await stream.finalMessage();

      // After a fallback hand-off, only text after the last fallback block is the served answer.
      const lastFallback = final.content.map((b) => b.type).lastIndexOf("fallback");
      const text = final.content
        .slice(lastFallback + 1)
        .flatMap((b) => (b.type === "text" ? [b.text] : []))
        .join("")
        .trim();

      return {
        text,
        usage: toUsage(final.model, final.usage),
        refused: final.stop_reason === "refusal",
      };
    } catch (err) {
      wrap(err);
    }
  }
}

const judgeSchema = z.object({
  verdict: z.enum(["faithful", "partially_faithful", "unfaithful"]),
  score: z.number(),
  unsupported_claims: z.array(z.string()),
});

const JUDGE_SYSTEM_PROMPT = `You are a strict evaluator of retrieval-augmented answers. Given numbered source passages, a question and an answer, decide whether every factual claim in the answer is directly supported by the passages.
- Ignore citation markers like [1] when reading the claims, but a claim is only supported if some passage states it.
- An explicit "I don't know" answer makes no claims and is faithful.
- score is the fraction of factual claims that are supported, between 0 and 1.
- List each unsupported claim verbatim or paraphrased in unsupported_claims.`;

/** LLM-as-judge for answer faithfulness, on the fast model with structured output. */
export class AnthropicFaithfulnessJudge implements FaithfulnessJudge {
  private readonly client: Anthropic;

  constructor(
    apiKey: string,
    readonly model: string,
    client?: Anthropic,
  ) {
    this.client = client ?? new Anthropic({ apiKey, maxRetries: 3, timeout: 60_000 });
  }

  async judge(input: { question: string; answer: string; sources: SourcePassage[] }): Promise<FaithfulnessVerdict> {
    try {
      const res = await this.client.messages.parse({
        model: this.model,
        max_tokens: 1024,
        system: JUDGE_SYSTEM_PROMPT,
        output_config: { format: zodOutputFormat(judgeSchema) },
        messages: [
          {
            role: "user",
            content: `${buildAnswerUserMessage(input.question, input.sources)}\n\n<answer>${input.answer}</answer>`,
          },
        ],
      });
      const parsed = res.parsed_output;
      if (!parsed) throw new ProviderError("anthropic", "judge returned no parseable verdict");
      return {
        verdict: parsed.verdict,
        score: Math.min(1, Math.max(0, parsed.score)),
        unsupportedClaims: parsed.unsupported_claims,
        usage: toUsage(res.model, res.usage),
      };
    } catch (err) {
      if (err instanceof ProviderError) throw err;
      wrap(err);
    }
  }
}
