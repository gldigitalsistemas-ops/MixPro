import { supabaseAdmin } from "@/lib/supabase/server";
import {
  getAuthorizedPayment,
  getPayment,
  getPreapproval,
  settleAuthorizedPayment,
  settlePayment,
  syncSubscription,
  verifyWebhookSignature,
  type Settlement,
} from "@/lib/payments";

/**
 * Notificações do Mercado Pago (pagamentos avulsos e plano mensal). O status e o valor são
 * sempre confirmados na API com o nosso token; a notificação em si não é prova de pagamento.
 */
export async function POST(req: Request) {
  const url = new URL(req.url);
  const body = (await req.json().catch(() => ({}))) as { type?: string; topic?: string; data?: { id?: string | number } };
  const type = body.type ?? body.topic ?? url.searchParams.get("type") ?? url.searchParams.get("topic") ?? "";
  const dataId = String(url.searchParams.get("data.id") ?? body.data?.id ?? url.searchParams.get("id") ?? "");

  const kind =
    type === "payment"
      ? "payment"
      : type === "subscription_authorized_payment" || type === "authorized_payment"
        ? "subscription_payment"
        : type === "subscription_preapproval" || type === "preapproval"
          ? "subscription"
          : null;
  if (!kind || !dataId) return new Response("OK");

  const signature = req.headers.get("x-signature");
  if (signature && !verifyWebhookSignature(signature, req.headers.get("x-request-id") ?? "", dataId)) {
    console.warn("[webhook] assinatura inválida", dataId);
    return new Response("Unauthorized", { status: 401 });
  }

  const admin = supabaseAdmin();
  if (kind === "subscription") {
    // status do plano muda (autorizado, pausado, cancelado): só sincroniza
    try {
      await syncSubscription(await getPreapproval(dataId));
      return new Response("OK");
    } catch (e) {
      console.error("[webhook preapproval]", e);
      return new Response("Erro", { status: 500 });
    }
  }

  try {
    // o mesmo pagamento avisa de novo quando muda de status (aprovado → estornado/contestado):
    // o controle de "já processado" é por pagamento + status, não só pelo número
    let status: string;
    let settle: () => Promise<Settlement>;
    if (kind === "payment") {
      const p = await getPayment(dataId);
      status = p.status;
      settle = () => settlePayment(p);
    } else {
      const ap = await getAuthorizedPayment(dataId);
      status = ap.status;
      settle = () => settleAuthorizedPayment(ap);
    }
    const eventKey = `mp_${kind}_${dataId}_${status}`;
    const { data: seen } = await admin.from("webhook_events").select("processed").eq("id", eventKey).maybeSingle();
    if (seen?.processed) return new Response("OK");
    await admin.from("webhook_events").upsert({ id: eventKey, payload: body });

    const result = await settle();
    // pendente: o Mercado Pago avisa de novo quando o status mudar
    if (result !== "pending") await admin.from("webhook_events").update({ processed: true }).eq("id", eventKey);
    return new Response("OK");
  } catch (e) {
    console.error("[webhook]", e);
    // 500 faz o Mercado Pago tentar de novo mais tarde
    return new Response("Erro", { status: 500 });
  }
}
