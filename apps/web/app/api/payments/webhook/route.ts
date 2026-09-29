import { supabaseAdmin } from "@/lib/supabase/server";
import { getPayment, verifyWebhookSignature } from "@/lib/payments";

/**
 * Notificações do Mercado Pago. O status e o valor são sempre confirmados na API
 * com o nosso token; a notificação em si não é considerada prova de pagamento.
 */
export async function POST(req: Request) {
  const url = new URL(req.url);
  const body = (await req.json().catch(() => ({}))) as { type?: string; topic?: string; data?: { id?: string | number } };
  const type = body.type ?? body.topic ?? url.searchParams.get("type") ?? url.searchParams.get("topic");
  const dataId = String(url.searchParams.get("data.id") ?? body.data?.id ?? url.searchParams.get("id") ?? "");

  if (type !== "payment" || !dataId) return new Response("OK");

  const signature = req.headers.get("x-signature");
  if (signature && !verifyWebhookSignature(signature, req.headers.get("x-request-id") ?? "", dataId)) {
    console.warn("[webhook] assinatura inválida", dataId);
    return new Response("Unauthorized", { status: 401 });
  }

  const admin = supabaseAdmin();
  const eventKey = `mp_payment_${dataId}`;
  const { data: seen } = await admin.from("webhook_events").select("processed").eq("id", eventKey).maybeSingle();
  if (seen?.processed) return new Response("OK");
  await admin.from("webhook_events").upsert({ id: eventKey, payload: body });

  try {
    const payment = await getPayment(dataId);
    const ref = payment.external_reference ?? "";
    if (payment.status === "approved" && payment.currency_id === "BRL") {
      const { error } = await admin.rpc("approve_payment_order", {
        p_external_ref: ref,
        p_mp_payment_id: String(payment.id),
        p_idempotency_key: `mp_payment_${payment.id}`,
        p_amount_paid: payment.transaction_amount,
      });
      if (error) throw error;
    } else if (["rejected", "cancelled", "refunded", "charged_back"].includes(payment.status)) {
      await admin.rpc("fail_payment_order", { p_external_ref: ref, p_mp_payment_id: String(payment.id), p_reason: payment.status });
    } else {
      // pending / in_process: o Mercado Pago avisa de novo quando mudar
      return new Response("OK");
    }
    await admin.from("webhook_events").update({ processed: true }).eq("id", eventKey);
    return new Response("OK");
  } catch (e) {
    console.error("[webhook]", e);
    // 500 faz o Mercado Pago tentar de novo mais tarde
    return new Response("Erro", { status: 500 });
  }
}
