import { withUser } from "@/lib/api";
import { premiumDeps } from "@/lib/export/server-deps";
import { revise } from "@/lib/premium/server";
import { failResponse, smallJson } from "@/lib/premium/route-helpers";

/** Revisão (Mix & Master IA e Voz finalizada): refaz com as escolhas novas, dentro do prazo. */
export async function POST(req: Request, ctx: RouteContext<"/api/premium/projects/[id]/revise">) {
  const { id } = await ctx.params;
  const body = await smallJson<{ params?: unknown }>(req);
  return withUser(async (userId) => {
    const r = await revise(premiumDeps(req), userId, id, body?.params ?? {});
    if (!r.ok) return failResponse(r);
    return Response.json({ job_id: r.jobId });
  });
}
