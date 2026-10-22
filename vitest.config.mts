import path from "node:path";
import { defineConfig } from "vitest/config";

const alias = { "@": path.resolve(import.meta.dirname, "src") };

// Tests never call paid APIs, even when a developer's shell or .env has keys.
const env = {
  DIGESTO_LLM_PROVIDER: "offline",
  DIGESTO_EMBEDDINGS_PROVIDER: "local",
  DIGESTO_RERANKER: "none",
  ANTHROPIC_API_KEY: "",
  VOYAGE_API_KEY: "",
};

export default defineConfig({
  resolve: { alias },
  test: {
    projects: [
      {
        resolve: { alias },
        test: {
          name: "unit",
          include: ["tests/unit/**/*.test.ts"],
          environment: "node",
          env,
        },
      },
      {
        resolve: { alias },
        test: {
          name: "integration",
          include: ["tests/integration/**/*.test.ts"],
          environment: "node",
          env,
          // Each file owns a database; run files serially to keep Postgres load predictable.
          fileParallelism: false,
          testTimeout: 60_000,
          hookTimeout: 120_000,
        },
      },
    ],
  },
});
