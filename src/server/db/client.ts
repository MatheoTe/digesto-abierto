import type { ExtractTablesWithRelations } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { Pool } from "pg";
import { getEnv } from "../config/env";
import * as schema from "./schema";

export type Schema = typeof schema;
export type Db = PgDatabase<PgQueryResultHKT, Schema, ExtractTablesWithRelations<Schema>>;

export interface DbHandle {
  db: Db;
  close(): Promise<void>;
}

/**
 * Postgres 17 with pgvector and unaccent: docker-compose locally, a service
 * container in CI, Neon in production. Embedded Postgres (PGlite) is not an
 * option here: the Spanish full-text configuration needs `unaccent`.
 */
export async function createDb(url: string): Promise<DbHandle> {
  // Serverless functions keep a small pool; scripts reuse the same default.
  const pool = new Pool({ connectionString: url, max: 10 });
  const db = drizzle(pool, { schema }) as unknown as Db;
  return { db, close: () => pool.end() };
}

const globalForDb = globalThis as unknown as { __digestoDb?: Promise<DbHandle> };

/** Process-wide singleton (survives Next.js dev hot reloads). */
export function getDb(): Promise<Db> {
  globalForDb.__digestoDb ??= createDb(getEnv().DATABASE_URL);
  return globalForDb.__digestoDb.then((h) => h.db);
}
