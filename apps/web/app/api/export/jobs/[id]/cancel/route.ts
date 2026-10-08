import { withUser } from "@/lib/api";
import { exportDeps, failResponse, unavailableResponse } from "@/lib/export/server-deps";
import { cancelJob } from "@/lib/export/server-jobs";

/** Cancela o job (na fila ou rodando): libera a reserva de crédito e apaga o arquivo enviado. */
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return withUser(async (userId) => {
    let deps;
    try {
      deps = exportDeps();
    } catch {
      return unavailableResponse();
    }
    const r = await cancelJob(deps, userId, id);
    if (!r.ok) return failResponse(r);
    return Response.json({ status: r.status });
  });
}
