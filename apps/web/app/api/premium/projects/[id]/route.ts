import { withUser } from "@/lib/api";
import { premiumDeps } from "@/lib/export/server-deps";
import { projectStatus } from "@/lib/premium/server";
import { failResponse, isFail } from "@/lib/premium/route-helpers";

/** Andamento do projeto: prévia, pagamento, trabalho final e arquivos (URLs de 10 min). */
export async function GET(req: Request, ctx: RouteContext<"/api/premium/projects/[id]">) {
  const { id } = await ctx.params;
  return withUser(async (userId) => {
    const r = await projectStatus(premiumDeps(req), userId, id);
    if (isFail(r)) return failResponse(r);
    return Response.json(r, { headers: { "Cache-Control": "no-store" } });
  });
}
