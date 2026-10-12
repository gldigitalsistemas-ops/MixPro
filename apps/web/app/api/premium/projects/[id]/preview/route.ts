import { withUser } from "@/lib/api";
import { premiumDeps } from "@/lib/export/server-deps";
import { startPreview } from "@/lib/premium/server";
import { failResponse, smallJson } from "@/lib/premium/route-helpers";

/** Prévia grátis (30 s) com as escolhas atuais. */
export async function POST(req: Request, ctx: RouteContext<"/api/premium/projects/[id]/preview">) {
  const { id } = await ctx.params;
  const body = await smallJson<{ params?: unknown }>(req);
  return withUser(async (userId) => {
    const r = await startPreview(premiumDeps(req), userId, id, body?.params ?? {});
    if (!r.ok) return failResponse(r);
    return Response.json({ job_id: r.jobId });
  });
}
