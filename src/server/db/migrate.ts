import path from "node:path";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { DbHandle } from "./client";

export const MIGRATIONS_FOLDER = path.resolve(process.cwd(), "drizzle");

export async function runMigrations(handle: DbHandle, migrationsFolder = MIGRATIONS_FOLDER): Promise<void> {
  await migrate(handle.db as unknown as NodePgDatabase, { migrationsFolder });
}
