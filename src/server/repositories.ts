import { and, asc, count, desc, eq, gte, inArray, max, sql, sum } from "drizzle-orm";
import type { Db } from "./db/client";
import { chunks, ordinances, traces } from "./db/schema";
import { NotFoundError } from "./errors";

export async function getChunk(db: Db, id: string) {
  const [row] = await db
    .select({
      id: chunks.id,
      ordinanceNumber: chunks.ordinanceNumber,
      ordinal: chunks.ordinal,
      kind: chunks.kind,
      label: chunks.label,
      content: chunks.content,
      headingPath: chunks.headingPath,
    })
    .from(chunks)
    .where(eq(chunks.id, id));
  if (!row) throw new NotFoundError("Chunk", id);
  return row;
}

export async function getOrdinance(db: Db, number: number) {
  const [ordinance] = await db.select().from(ordinances).where(eq(ordinances.number, number));
  if (!ordinance) throw new NotFoundError("Ordinance", String(number));
  const rows = await db
    .select({
      id: chunks.id,
      ordinal: chunks.ordinal,
      kind: chunks.kind,
      label: chunks.label,
      content: chunks.content,
      headingPath: chunks.headingPath,
    })
    .from(chunks)
    .where(and(eq(chunks.ordinanceNumber, number), sql`${chunks.kind} <> 'record'`))
    .orderBy(asc(chunks.ordinal));
  return { ...ordinance, chunks: rows };
}

export type OrdinanceDetail = Awaited<ReturnType<typeof getOrdinance>>;

/** Which of these ordinance numbers exist in the corpus (for linking relations). */
export async function knownOrdinances(db: Db, numbers: number[]): Promise<Set<number>> {
  if (!numbers.length) return new Set();
  const rows = await db
    .select({ number: ordinances.number })
    .from(ordinances)
    .where(inArray(ordinances.number, numbers));
  return new Set(rows.map((r) => r.number));
}

export function listTraces(db: Db, limit: number) {
  return db.select().from(traces).orderBy(desc(traces.createdAt)).limit(limit);
}

export interface CorpusStats {
  ordinances: number;
  inForce: number;
  withText: number;
  articles: number;
  lastSanctionedOn: string | null;
  lastUpdatedAt: Date | null;
}

export async function getCorpusStats(db: Db): Promise<CorpusStats> {
  const [o] = await db
    .select({
      ordinances: count(),
      inForce: count(sql`case when ${ordinances.inForce} then 1 end`),
      withText: count(sql`case when ${ordinances.textSource} is not null then 1 end`),
      lastSanctionedOn: max(ordinances.sanctionedOn),
      lastUpdatedAt: max(ordinances.updatedAt),
    })
    .from(ordinances);
  const [c] = await db.select({ articles: count() }).from(chunks).where(eq(chunks.kind, "article"));
  return {
    ordinances: o.ordinances,
    inForce: o.inForce,
    withText: o.withText,
    articles: c.articles,
    lastSanctionedOn: o.lastSanctionedOn,
    lastUpdatedAt: o.lastUpdatedAt ? new Date(o.lastUpdatedAt) : null,
  };
}

/** Start of the current calendar day in Buenos Aires, as a UTC instant. */
export function startOfDayBuenosAires(now = new Date()): Date {
  const local = new Date(now.getTime() - 3 * 60 * 60_000);
  return new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) + 3 * 60 * 60_000);
}

/** USD spent on answers so far today (Buenos Aires time). */
export async function spentToday(db: Db, now = new Date()): Promise<number> {
  const [row] = await db
    .select({ total: sum(traces.costUsd) })
    .from(traces)
    .where(gte(traces.createdAt, startOfDayBuenosAires(now)));
  return Number(row.total ?? 0);
}
