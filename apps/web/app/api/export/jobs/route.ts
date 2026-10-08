import { withUser } from "@/lib/api";
import { exportDeps, failResponse, unavailableResponse } from "@/lib/export/server-deps";
import { createJob } from "@/lib/export/server-jobs";

/**
 * Cria um job de exportação no servidor. O corpo é o texto do ExportJob (validado de novo aqui);
 * o tamanho do áudio a enviar vem no cabeçalho x-input-bytes. Responde com a URL (PUT) para o envio
 * direto ao R2. O crédito é só reservado: o débito acontece na entrega.
 */
export async function POST(req: Request) {
  const body = await req.text();
  const inputBytes = Number(req.headers.get("x-input-bytes"));
  const platform = req.headers.get("x-client-platform");
  return withUser(async (userId) => {
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
