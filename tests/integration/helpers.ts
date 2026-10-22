import { sql } from "drizzle-orm";
import { buildChunks, corpusEmbeddingInput, laterAmendments } from "@/server/corpus/chunks";
import { toOrdinanceRow } from "@/server/corpus/record";
import { segmentOrdinance } from "@/server/corpus/segment";
import { createDb, type DbHandle } from "@/server/db/client";
import { runMigrations } from "@/server/db/migrate";
import { chunks, ordinances } from "@/server/db/schema";
import type { EmbeddingProvider } from "@/server/providers/embeddings/types";
import { FIXTURE_ORDINANCES } from "../fixtures/ordenanzas";

/**
 * Integration tests need real Postgres: the Spanish, unaccented full-text
 * configuration uses the `unaccent` extension. CI runs a pgvector service
 * container; locally, `createdb digesto_test` (or set TEST_DATABASE_URL).
 */
export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgres://localhost:5432/digesto_test";

export async function createTestDb(): Promise<DbHandle> {
  const handle = await createDb(TEST_DATABASE_URL);
  await runMigrations(handle);
  await resetDb(handle);
  return handle;
}

export async function resetDb(handle: DbHandle): Promise<void> {
  await handle.db.execute(sql`TRUNCATE traces, embedding_cache, chunks, ordinances CASCADE`);
}

/** Loads the fictional fixture digest the same way corpus-build does, and embeds what is in force. */
export async function loadFixtureCorpus(handle: DbHandle, embeddings: EmbeddingProvider): Promise<void> {
  for (const f of FIXTURE_ORDINANCES) {
    const text = f.text ? { source: f.text.source, url: `https://www.concejomdp.gov.ar/biblioteca/docs/o${f.record.nro}.html` } : null;
    const row = toOrdinanceRow(f.record, f.page, text);
    const segmented = f.text && row.inForce ? segmentOrdinance(f.text.body) : null;
    row.laterAmendments = row.inForce ? laterAmendments(row, segmented) : [];
    const built = buildChunks(row, segmented);
    row.chunkCount = built.length;
    await handle.db.insert(ordinances).values(row);
    const vectors = row.inForce ? (await embeddings.embedDocuments(built.map(corpusEmbeddingInput))).vectors : [];
    await handle.db
      .insert(chunks)
      .values(built.map((c, i) => ({ ...c, embedding: vectors[i] ?? null, embeddingModel: vectors[i] ? embeddings.model : null })));
  }
}
