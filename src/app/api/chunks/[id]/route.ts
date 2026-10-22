import { getDb } from "@/server/db/client";
import { withErrors } from "@/server/http/route";
import { idParamSchema, parseOrThrow } from "@/server/http/schemas";
import { getChunk } from "@/server/repositories";

export const GET = withErrors(async (_request: Request, ctx: RouteContext<"/api/chunks/[id]">) => {
  const { id } = parseOrThrow(idParamSchema, await ctx.params);
  return Response.json({ chunk: await getChunk(await getDb(), id) });
});
