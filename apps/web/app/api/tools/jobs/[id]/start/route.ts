import { withUser } from "@/lib/api";
import { failResponse, toolDeps, unavailableResponse } from "@/lib/export/server-deps";
import { startTool } from "@/lib/tools/server-tools";

/** Os arquivos já foram enviados: confere e põe o job na fila (repetir não duplica). */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return withUser(async (userId) => {
    let deps;
    try {
      deps = toolDeps(req);
    } catch {
      return unavailableResponse();
    }
    const r = await startTool(deps, userId, id);
    if (!r.ok) return failResponse(r);
    return Response.json({ status: r.status });
  });
}
