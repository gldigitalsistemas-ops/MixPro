import { withUser } from "@/lib/api";
import { createShare, type ShareInput } from "@/lib/share/server";
import { shareDeps } from "@/lib/share/deps";

/** Cria a página antes/depois (24 h) e devolve as URLs de envio dos dois trechos. */
export async function POST(req: Request) {
  if (Number(req.headers.get("content-length") ?? 0) > 4_000) return Response.json({ error: "Pedido grande demais." }, { status: 413 });
  const body = (await req.json().catch(() => null)) as ShareInput | null;
  return withUser(async (userId) => {
    const deps = shareDeps();
    if (!deps) return Response.json({ error: "Compartilhamento indisponível no momento." }, { status: 503 });
    const r = await createShare(deps, userId, body ?? {});
    if (!r.ok) return Response.json({ error: r.error }, { status: r.status });
    return Response.json({ token: r.token, url: `/ouvir/${r.token}`, uploads: r.uploads });
  });
}
