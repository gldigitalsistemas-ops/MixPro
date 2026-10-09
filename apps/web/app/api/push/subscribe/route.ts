import { getSession, supabaseAdmin } from "@/lib/supabase/server";
import { jsonError } from "@/lib/errors";
import { validSubscription } from "@/lib/push/messages";

/** Ativa a notificação diária neste navegador (com ou sem login; logado, fica ligada à conta). */
export async function POST(req: Request) {
  if (Number(req.headers.get("content-length") ?? 0) > 4000) return jsonError(413, "Pedido grande demais.");
  const sub = validSubscription(await req.json().catch(() => null));
  if (!sub) return jsonError(400, "Este navegador não permitiu as notificações.");
  const session = await getSession().catch(() => null);
  const { error } = await supabaseAdmin()
    .from("push_subscriptions")
    .upsert({ endpoint: sub.endpoint, p256dh: sub.keys.p256dh, auth: sub.keys.auth, user_id: session?.userId ?? null, failures: 0 }, { onConflict: "endpoint" });
  if (error) return jsonError(500, "Não foi possível ativar as notificações agora.");
  return Response.json({ ok: true });
}

/** Desativa neste navegador (quem tem o endpoint é o próprio navegador inscrito). */
export async function DELETE(req: Request) {
  const body = (await req.json().catch(() => null)) as { endpoint?: unknown } | null;
  if (!body || typeof body.endpoint !== "string" || body.endpoint.length > 1000) return jsonError(400, "Pedido inválido.");
  await supabaseAdmin().from("push_subscriptions").delete().eq("endpoint", body.endpoint);
  return Response.json({ ok: true });
}
