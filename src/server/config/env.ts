import { z } from "zod";

/**
 * Runtime configuration, validated once and cached.
 *
 * Every provider has an "auto" mode: if the matching API key is present the
 * real provider is used, otherwise Digesto Abierto falls back to a
 * deterministic local implementation. That is what lets the test suite and CI
 * run with no secrets at all.
 */
const optionalSecret = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v ? v : undefined));

const envSchema = z.object({
  DATABASE_URL: z.string().min(1).default("postgres://localhost:5432/digesto"),

  ANTHROPIC_API_KEY: optionalSecret,
  VOYAGE_API_KEY: optionalSecret,

  DIGESTO_LLM_PROVIDER: z.enum(["auto", "anthropic", "offline"]).default("auto"),
  /** auto = Voyage with a Voyage key, else none (words only). "local" = offline hashed vectors, for tests. */
  DIGESTO_EMBEDDINGS_PROVIDER: z.enum(["auto", "voyage", "local", "none"]).default("auto"),
  /** auto = Voyage with a Voyage key, else Claude Haiku with an Anthropic key, else none. */
  DIGESTO_RERANKER: z.enum(["auto", "voyage", "claude", "none"]).default("auto"),

  DIGESTO_ANSWER_MODEL: z.string().default("claude-sonnet-5-5"),
  DIGESTO_FAST_MODEL: z.string().default("claude-haiku-4-5-20251001"),
  DIGESTO_ANSWER_EFFORT: z.enum(["low", "medium", "high"]).default("low"),
  DIGESTO_VOYAGE_EMBED_MODEL: z.string().default("voyage-4"),
  DIGESTO_VOYAGE_RERANK_MODEL: z.string().default("rerank-3"),

  DIGESTO_RETRIEVAL_K: z.coerce.number().int().min(1).max(20).default(8),

  /** Questions per client per minute. */
  DIGESTO_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).default(6),
  /**
   * Spend cap for the public site, in USD per calendar day (Buenos Aires time),
   * measured from the cost recorded on each trace. 0 disables the cap.
   */
  DIGESTO_DAILY_BUDGET_USD: z.coerce.number().min(0).default(2),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | undefined;

export function getEnv(): Env {
  if (!cached) {
    const parsed = envSchema.safeParse(process.env);
    if (!parsed.success) {
      const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
      throw new Error(`Invalid environment configuration: ${issues}`);
    }
    cached = parsed.data;
  }
  return cached;
}

/** Test hook: forget the cached env so a test can mutate process.env. */
export function resetEnvCache(): void {
  cached = undefined;
}
