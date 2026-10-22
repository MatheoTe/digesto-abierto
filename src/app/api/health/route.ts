import { sql } from "drizzle-orm";
import { connection } from "next/server";
import { getDb } from "@/server/db/client";
import { describeProviders, getProviders } from "@/server/providers";

export async function GET() {
  await connection();
  try {
    const db = await getDb();
    await db.execute(sql`select 1`);
    return Response.json({ status: "ok", providers: describeProviders(getProviders()) });
  } catch {
    return Response.json({ status: "degraded", database: "unreachable" }, { status: 503 });
  }
}
