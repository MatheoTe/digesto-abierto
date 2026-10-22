import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { inArray, sql } from "drizzle-orm";
import { getEnv } from "@/server/config/env";
import { buildChunks, laterAmendments } from "@/server/corpus/chunks";
import { decodeBytes, htmlToText } from "@/server/corpus/html";
import { parseRecordPage, toOrdinanceRow, type SourceRecord } from "@/server/corpus/record";
import { segmentOrdinance, type Segmented } from "@/server/corpus/segment";
import { createDb } from "@/server/db/client";
import { chunks, ordinances, type NewOrdinance } from "@/server/db/schema";

/**
 * Builds the corpus tables from what the crawlers left in data/raw:
 * every ordinance gets a row (so "is 15043 still in force?" can be answered),
 * and every ordinance in force gets its record card plus one chunk per article.
 * Chunks are replaced per ordinance; embeddings are filled later by
 * `npm run corpus:embed`, which reuses the content-addressed cache.
 *
 *   npm run corpus:build [-- --only 4471,26500]
 */
const RAW = path.resolve("data/raw");
const BATCH = 200;

function readGz(file: string): Buffer | null {
  return fs.existsSync(file) ? zlib.gunzipSync(fs.readFileSync(file)) : null;
}

async function main() {
  const onlyArg = process.argv.indexOf("--only");
  const only = onlyArg > -1 ? new Set(process.argv[onlyArg + 1].split(",").map(Number)) : null;
  const handle = await createDb(process.env.DATABASE_URL_UNPOOLED?.trim() || getEnv().DATABASE_URL);
  const db = handle.db;

  const files = fs
    .readdirSync(path.join(RAW, "meta"))
    .map((f) => Number(f.replace(".json", "")))
    .filter((n) => !only || only.has(n))
    .sort((a, b) => a - b);

  const stats = { ordinances: 0, inForce: 0, withText: 0, consolidated: 0, chunks: 0, articles: 0 };
  let rows: NewOrdinance[] = [];
  let drafts: ReturnType<typeof buildChunks> = [];

  const flush = async () => {
    if (!rows.length) return;
    const numbers = rows.map((r) => r.number);
    await db.transaction(async (tx) => {
      await tx
        .insert(ordinances)
        .values(rows)
        .onConflictDoUpdate({
          target: ordinances.number,
          set: Object.fromEntries(
            Object.keys(rows[0])
              .filter((k) => k !== "number")
              .map((k) => [k, sql.raw(`excluded."${toSnake(k)}"`)]),
          ),
        });
      await tx.delete(chunks).where(inArray(chunks.ordinanceNumber, numbers));
      for (let i = 0; i < drafts.length; i += 1000) await tx.insert(chunks).values(drafts.slice(i, i + 1000));
    });
    rows = [];
    drafts = [];
  };

  for (const n of files) {
    const meta = JSON.parse(fs.readFileSync(path.join(RAW, "meta", `${n}.json`), "utf8"));
    if (meta.status !== "OK") continue;
    const record = meta.data as SourceRecord;
    const inForce = !record.abrogacion_n && !record.fec_excluido;

    let segmented: Segmented | null = null;
    let text: { source: "actualizado" | "original"; url: string } | null = null;
    let page = null;
    if (inForce) {
      const textMeta = path.join(RAW, "texto", `${n}.json`);
      if (fs.existsSync(textMeta)) {
        const info = JSON.parse(fs.readFileSync(textMeta, "utf8"));
        const html = readGz(path.join(RAW, "texto", `${n}.html.gz`));
        if (info.fuente && html) {
          text = { source: info.fuente, url: info.url };
          segmented = segmentOrdinance(htmlToText(decodeBytes(html)));
        }
      }
      const pageHtml = readGz(path.join(RAW, "ficha", `${n}.html.gz`));
      if (pageHtml) page = parseRecordPage(pageHtml.toString("utf8"));
    }

    const row = toOrdinanceRow(record, page, text);
    row.laterAmendments = inForce ? laterAmendments(row, segmented) : [];
    // Ordinances no longer in force keep their record card (so a question that names
    // one can say it was repealed) but no text and no vector.
    const built = buildChunks(row, inForce ? segmented : null);
    row.chunkCount = built.length;
    rows.push(row);
    drafts.push(...built);

    stats.ordinances++;
    if (inForce) stats.inForce++;
    if (text) stats.withText++;
    if (segmented?.header.consolidated) stats.consolidated++;
    stats.chunks += built.length;
    stats.articles += built.filter((c) => c.kind === "article").length;
    if (rows.length >= BATCH) await flush();
  }
  await flush();
  // Document frequencies for IDF-weighted lexical ranking (see termStats in the schema).
  await db.transaction(async (tx) => {
    await tx.execute(sql`truncate term_stats`);
    await tx.execute(sql`insert into term_stats (term, df) select word, ndoc from ts_stat('select tsv from chunks')`);
  });
  await handle.close();
  console.log(JSON.stringify(stats));
}

function toSnake(key: string): string {
  return key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
