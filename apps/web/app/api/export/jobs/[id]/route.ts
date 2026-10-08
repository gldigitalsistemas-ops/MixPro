import { withUser } from "@/lib/api";
import { exportDeps, failResponse, unavailableResponse } from "@/lib/export/server-deps";
import { jobStatus } from "@/lib/export/server-jobs";

/** Andamento do job (progresso real) e, quando pronto, a URL de download (válida por 60 s). */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return withUser(async (userId) => {
    let deps;
    try {
      deps = exportDeps();
    } catch {
      return unavailableResponse();
    }
    const r = await jobStatus(deps, userId, id);
    if (!r.ok) return failResponse(r);
    return Response.json({
      status: r.status,
      progress: r.progress,
      credit_state: r.creditState,
      error_code: r.errorCode,
      message: r.message,
      device: r.device,
      download_url: r.downloadUrl,
    });
  });
}
