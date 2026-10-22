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
let page = 512;
let parallel = 3;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const handle = await createDb(process.env.DATABASE_URL_UNPOOLED?.trim() || getEnv().DATABASE_URL);
  const db = handle.db;
  const { embeddings } = getProviders();
  const model = embeddings.model;
  if (embeddings.kind === "none") {
    console.log("Sin proveedor de vectores (falta VOYAGE_API_KEY): el sitio busca solo por palabras. Nada que hacer.");
    await handle.close();
    return;
  }
  console.log(`modelo: ${model}`);

  // Searchable by meaning: the record card of every ordinance in force, and the text of the
  // general ones. Particular ordinances (a permit for one shop, a street name) are most of the
  // digest; their articles stay reachable by words, and leaving them out keeps the index in a
  // free Postgres tier. Repealed ordinances are reached by number only.
  const general = db.select({ n: ordinances.number }).from(ordinances).where(and(eq(ordinances.inForce, true), sql`coalesce(${ordinances.scope}, '') <> 'P'`));
  const inForce = db.select({ n: ordinances.number }).from(ordinances).where(eq(ordinances.inForce, true));
  const searchable = or(inArray(chunks.ordinanceNumber, general), and(eq(chunks.kind, "record"), inArray(chunks.ordinanceNumber, inForce)));
  const pending = and(or(isNull(chunks.embedding), ne(chunks.embeddingModel, model)), searchable);
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
    const PAGE = page;
    const PARALLEL = parallel;
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
    try {
      await Promise.all(pages.map(embedPage));
    } catch (err) {
      // Rate limited (Voyage without a payment method allows 3 requests and 10K tokens per
      // minute): wait a minute, go one small page at a time, and carry on where it stopped.
      const message = err instanceof Error ? err.message : String(err);
      if (/network error|timeout/i.test(message)) {
        console.log("corte de red con Voyage: reintento en 20 s");
        await sleep(20_000);
        continue;
      }
      if (!/429/.test(message)) throw err;
      page = Math.max(24, Math.floor(page / 2));
      parallel = 1;
      console.log(`límite de Voyage: espero 65 s y sigo de a ${page}`);
      await sleep(65_000);
      continue;
    }
    if (parallel === 1 && page < 512) await sleep(21_000); // stay under 3 requests per minute
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
