import { z } from "zod";
import { getDb } from "@/server/db/client";
import { withErrors } from "@/server/http/route";
import { parseOrThrow } from "@/server/http/schemas";
import { getOrdinance } from "@/server/repositories";

const paramsSchema = z.object({ numero: z.coerce.number().int().min(1).max(99999) });

/** GET /api/ordenanzas/4471 — the ordinance's record and its articles, in order. */
export const GET = withErrors(async (_request: Request, ctx: RouteContext<"/api/ordenanzas/[numero]">) => {
  const { numero } = parseOrThrow(paramsSchema, await ctx.params);
  return Response.json({ ordinance: await getOrdinance(await getDb(), numero) });
});
