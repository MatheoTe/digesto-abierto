import { EMBEDDING_DIMENSIONS } from "@/server/db/schema";
import { LocalHashEmbeddingProvider } from "@/server/providers/embeddings/local-hash";
import { createTestDb, loadFixtureCorpus } from "../integration/helpers";

/** E2E database: migrations plus the fictional fixture digest, embedded offline. */
async function main() {
  const handle = await createTestDb();
  await loadFixtureCorpus(handle, new LocalHashEmbeddingProvider(EMBEDDING_DIMENSIONS));
  await handle.close();
  console.log("✔ base de E2E lista");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
