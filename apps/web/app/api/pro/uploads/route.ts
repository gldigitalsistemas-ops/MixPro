import { withUser } from "@/lib/api";
import { proObjects } from "@/lib/pro/deps";
import { createProUpload } from "@/lib/pro/uploads";

/** Prepara o envio das faixas (até 60 arquivos): devolve o id e uma URL de envio por arquivo. */
export async function POST(req: Request) {
  if (Number(req.headers.get("content-length") ?? 0) > 30_000) return Response.json({ error: "Pedido grande demais." }, { status: 413 });
  const body = (await req.json().catch(() => null)) as { files?: unknown } | null;
  return withUser(async (userId) => {
    const objects = proObjects();
    if (!objects) return Response.json({ error: "Envio pelo app indisponível agora. Use um link do Drive ou WeTransfer." }, { status: 503 });
    const r = await createProUpload(objects, userId, body?.files);
    if (!r.ok) return Response.json({ error: r.error }, { status: 400 });
    return Response.json({ id: r.id, uploads: r.uploads, files_url: new URL(`/mixagem-profissional/arquivos/${r.id}`, req.url).toString() });
  });
}
