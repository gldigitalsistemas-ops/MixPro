import { withUser } from "@/lib/api";
import { failResponse, toolDeps, unavailableResponse } from "@/lib/export/server-deps";
import { cancelTool } from "@/lib/tools/server-tools";

/** Cancela: libera os créditos reservados e apaga os arquivos enviados. */
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return withUser(async (userId) => {
    let deps;
    try {
      deps = toolDeps();
    } catch {
      return unavailableResponse();
    }
    const r = await cancelTool(deps, userId, id);
    if (!r.ok) return failResponse(r);
    return Response.json({ status: r.status });
  });
}
