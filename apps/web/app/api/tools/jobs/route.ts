import { withUser } from "@/lib/api";
import { exportServerConfigured, failResponse, toolDeps, unavailableResponse } from "@/lib/export/server-deps";
import { createTool } from "@/lib/tools/server-tools";

/** Cria um job de ferramenta: valida, calcula o preço, reserva os créditos e devolve as URLs de envio. */
export async function POST(req: Request) {
  if (Number(req.headers.get("content-length") ?? 0) > 20_000) return Response.json({ error: "Pedido grande demais.", code: "TOO_LARGE" }, { status: 413 });
  const body = (await req.json().catch(() => null)) as { tool?: unknown; params?: unknown; input_bytes?: unknown } | null;
  return withUser(async (userId) => {
    if (!exportServerConfigured()) return unavailableResponse();
    const r = await createTool(toolDeps(), userId, {
      tool: typeof body?.tool === "string" ? body.tool : "",
      params: body?.params,
      inputBytes: Array.isArray(body?.input_bytes) ? (body!.input_bytes as number[]) : [],
    });
    if (!r.ok) return failResponse(r);
    return Response.json({ job_id: r.jobId, credits: r.credits, uploads: r.uploads, retention_days: r.retentionDays });
  });
}
