import { withUser } from "@/lib/api";
import { exportDeps, exportServerConfigured, failResponse, unavailableResponse } from "@/lib/export/server-deps";
import { createJob } from "@/lib/export/server-jobs";

/**
 * Cria um job de exportação no servidor. O corpo é o texto do ExportJob (validado de novo aqui);
 * o tamanho do áudio a enviar vem no cabeçalho x-input-bytes. Responde com a URL (PUT) para o envio
 * direto ao R2. O crédito é só reservado: o débito acontece na entrega.
 */
export async function POST(req: Request) {
  // o job tem no máximo 64 KB: recusa antes de ler o corpo inteiro
  if (Number(req.headers.get("content-length") ?? 0) > 70_000) return Response.json({ error: "Pedido grande demais.", code: "TOO_LARGE", device: true }, { status: 413 });
  const body = await req.text();
  if (body.length > 70_000) return Response.json({ error: "Pedido grande demais.", code: "TOO_LARGE", device: true }, { status: 413 });
  const inputBytes = Number(req.headers.get("x-input-bytes"));
  const platform = req.headers.get("x-client-platform");
  return withUser(async (userId) => {
    // sem a fila configurada não cria job (ele ficaria parado com crédito reservado)
    if (!exportServerConfigured()) return unavailableResponse();
    let deps;
    try {
      deps = exportDeps();
    } catch {
      return unavailableResponse();
    }
    const r = await createJob(deps, userId, { body, inputBytes, platform });
    if (!r.ok) return failResponse(r);
    return Response.json({ job_id: r.jobId, outcome: r.outcome, upload: r.upload });
  });
}
