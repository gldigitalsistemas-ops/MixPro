import { withUser } from "@/lib/api";
import { shareProject, type ShareInput } from "@/lib/premium/showcase";
import { smallJson } from "@/lib/premium/route-helpers";

/** Autoriza um trecho de 30 s da produção na vitrine (opt-in; dá para retirar quando quiser). */
export async function POST(req: Request, ctx: RouteContext<"/api/premium/projects/[id]/showcase">) {
  const { id } = await ctx.params;
  const body = await smallJson<ShareInput>(req, 4000);
  return withUser(async (userId) => {
    const r = await shareProject(userId, id, body ?? {});
    if (!r.ok) return Response.json({ error: r.error }, { status: r.status });
    return Response.json({ item_id: r.id });
  });
}
