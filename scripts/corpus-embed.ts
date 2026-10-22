import { and, asc, eq, inArray, isNull, ne, or, sql } from "drizzle-orm";
import { getEnv } from "@/server/config/env";
import { corpusEmbeddingInput } from "@/server/corpus/chunks";
import { createDb } from "@/server/db/client";
import { chunks, embeddingCache, ordinances } from "@/server/db/schema";
import { getProviders } from "@/server/providers";

/**
 * Fills chunk embeddings for the active model. Content-addressed: a chunk
 * whose text was embedded before (same hash, same model) takes the cached
 * vector and costs nothing. Resumable — it only ever looks at chunks still
 * missing a vector for this model.
 *
 *   npm run corpus:embed
 */
const PAGE = 512;
const PARALLEL = 3;

async function main() {
  const handle = await createDb(process.env.DATABASE_URL_UNPOOLED?.trim() || getEnv().DATABASE_URL);
  const db = handle.db;
  const { embeddings } = getProviders();
  const model = embeddings.model;
  console.log(`modelo: ${model}`);

  // Only ordinances in force are searchable by meaning; repealed ones are reached by number.
  const inForce = inArray(chunks.ordinanceNumber, db.select({ n: ordinances.number }).from(ordinances).where(eq(ordinances.inForce, true)));
  const pending = and(or(isNull(chunks.embedding), ne(chunks.embeddingModel, model)), inForce);
  const [{ total }] = await db.select({ total: sql<number>`count(*)::int` }).from(chunks).where(pending);
  console.log(`${total} fragmentos sin vector`);

  let done = 0, fromCache = 0, tokens = 0;
  const started = Date.now();

  async function embedPage(rows: { id: string; contentHash: string; kind: string; label: string | null; content: string; headingPath: string; context: string }[]) {
    const hashes = [...new Set(rows.map((r) => r.contentHash))];
    const cached = await db
      .select({ contentHash: embeddingCache.contentHash, embedding: embeddingCache.embedding })
      .from(embeddingCache)
      .where(and(eq(embeddingCache.model, model), inArray(embeddingCache.contentHash, hashes)));
    const vectors = new Map(cached.map((c) => [c.contentHash, c.embedding]));
    const missing = rows.filter((r) => !vectors.has(r.contentHash));
    const unique = [...new Map(missing.map((r) => [r.contentHash, r])).values()];
    if (unique.length) {
      const batch = await embeddings.embedDocuments(unique.map((r) => corpusEmbeddingInput(r as Parameters<typeof corpusEmbeddingInput>[0])));
      tokens += batch.tokens;
      unique.forEach((r, i) => vectors.set(r.contentHash, batch.vectors[i]));
      await db
        .insert(embeddingCache)
        .values(unique.map((r, i) => ({ contentHash: r.contentHash, model, embedding: batch.vectors[i] })))
        .onConflictDoNothing();
    }
    fromCache += rows.length - missing.length;
    // One statement per page: UPDATE … FROM (VALUES …) keeps the round trips down.
    const values = sql.join(
      rows.map((r) => sql`(${r.id}::uuid, ${JSON.stringify(vectors.get(r.contentHash))}::halfvec)`),
      sql`, `,
    );
    await db.execute(sql`update chunks set embedding = v.e, embedding_model = ${model} from (values ${values}) as v(id, e) where chunks.id = v.id`);
    done += rows.length;
  }

  for (;;) {
    const rows = await db
      .select({
        id: chunks.id,
        contentHash: chunks.contentHash,
        kind: chunks.kind,
        label: chunks.label,
        content: chunks.content,
        headingPath: chunks.headingPath,
        context: chunks.context,
      })
      .from(chunks)
      .where(pending)
      .orderBy(asc(chunks.ordinanceNumber), asc(chunks.ordinal))
      .limit(PAGE * PARALLEL);
    if (!rows.length) break;
    const pages = Array.from({ length: Math.ceil(rows.length / PAGE) }, (_, i) => rows.slice(i * PAGE, (i + 1) * PAGE));
    await Promise.all(pages.map(embedPage));
    const secs = (Date.now() - started) / 1000;
    console.log(`${done}/${total} (${fromCache} del cache, ${tokens} tokens, ${Math.round(done / secs)}/s)`);
  }
  await handle.close();
  console.log(`listo: ${done} fragmentos, ${fromCache} del cache, ${tokens} tokens facturados`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
