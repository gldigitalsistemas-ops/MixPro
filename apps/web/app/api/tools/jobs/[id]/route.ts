import { withUser } from "@/lib/api";
import { failResponse, toolDeps, unavailableResponse } from "@/lib/export/server-deps";
import { toolStatus } from "@/lib/tools/server-tools";

/** Andamento real do job e, quando pronto, os arquivos (URLs assinadas de 5 min). */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return withUser(async (userId) => {
    let deps;
    try {
      deps = toolDeps();
    } catch {
      return unavailableResponse();
    }
    const r = await toolStatus(deps, userId, id);
    if (!r.ok) return failResponse(r);
    const { ok: _ok, ...rest } = r;
    void _ok;
    return Response.json(rest);
  });
}
