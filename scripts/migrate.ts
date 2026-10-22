import { getEnv } from "@/server/config/env";
import { createDb } from "@/server/db/client";
import { runMigrations } from "@/server/db/migrate";

/**
 * Migrations prefer DATABASE_URL_UNPOOLED: on Neon (and other PgBouncer-fronted
 * hosts) DDL and the migrator's advisory work belong on a direct connection,
 * while the app keeps using the pooled DATABASE_URL.
 */
async function main() {
  const url = process.env.DATABASE_URL_UNPOOLED?.trim() || getEnv().DATABASE_URL;
  const handle = await createDb(url);
  try {
    await runMigrations(handle);
    console.log("✔ migraciones aplicadas");
  } finally {
    await handle.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
