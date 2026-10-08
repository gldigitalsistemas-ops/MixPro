import { withUser } from "@/lib/api";
import { exportDeps, failResponse, unavailableResponse } from "@/lib/export/server-deps";
import { startJob } from "@/lib/export/server-jobs";

/** O áudio já foi enviado ao R2: confere o arquivo e põe o job na fila. Pode ser repetido sem duplicar. */
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return withUser(async (userId) => {
    let deps;
    try {
      deps = exportDeps();
    } catch {
      return unavailableResponse();
    }
    const r = await startJob(deps, userId, id);
    if (!r.ok) return failResponse(r);
    return Response.json({ status: r.status });
  });
}
