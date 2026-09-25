import { supabaseAdmin } from "@/lib/supabase/server";
import { fetchMpPayment, verifyWebhookSignature } from "@/lib/payments";

/**
 * Recebe notificações do Mercado Pago.
 * Docs: https://www.mercadopago.com.br/developers/pt/docs/your-integrations/notifications/webhooks
 *
 * MP envia POST com body: { action, api_version, data: { id }, type }
 * O tipo que nos interessa é "payment".
 */
export async function POST(req: Request) {
  const xSignature = req.headers.get("x-signature") ?? "";
  const xRequestId = req.headers.get("x-request-id") ?? "";

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return new Response("Bad Request", { status: 400 });
  }

  const dataId = String((body.data as Record<string, unknown>)?.id ?? "");
  const ts = xSignature.split(",").find((p) => p.startsWith("ts="))?.slice(3) ?? "";

  // Verificação de assinatura (pula se MP_WEBHOOK_SECRET não estiver configurado — ambiente de dev)
  if (process.env.MP_WEBHOOK_SECRET) {
    if (!verifyWebhookSignature(xSignature, xRequestId, dataId, ts)) {
      console.warn("[webhook] assinatura inválida");
      return new Response("Unauthorized", { status: 401 });
    }
  }

  // Só processamos notificações do tipo "payment"
  if (body.type !== "payment" || !dataId) {
    return new Response("OK", { status: 200 });
  }

  const eventKey = `mp_${dataId}`;
  const admin = supabaseAdmin();

  // Deduplicação: verifica se já processamos esta notificação
  const { data: existing } = await admin
    .from("webhook_events")
    .select("id, processed")
    .eq("id", eventKey)
    .maybeSingle();

  if (existing?.processed) {
    return new Response("OK", { status: 200 }); // já processado
  }

  // Registra o evento (upsert)
  await admin.from("webhook_events").upsert({ id: eventKey, payload: body });

  // Busca o pagamento no MP para obter status real e external_reference
  let payment;
  try {
    payment = await fetchMpPayment(dataId);
  } catch (e) {
    console.error("[webhook] erro ao buscar pagamento MP:", e);
    return new Response("Internal Error", { status: 500 });
  }

  const status = payment.status;
  const externalRef = payment.external_reference ?? "";
  const paymentId = String(payment.id ?? dataId);
  const idempotencyKey = `mp_payment_${paymentId}`;

  try {
    if (status === "approved") {
      await admin.rpc("approve_payment_order", {
        p_external_ref: externalRef,
        p_mp_payment_id: paymentId,
        p_idempotency_key: idempotencyKey,
      });
    } else if (status === "rejected" || status === "cancelled") {
      await admin.rpc("fail_payment_order", {
        p_external_ref: externalRef,
        p_mp_payment_id: paymentId,
        p_reason: status,
      });
    }
    // "pending", "in_process", "authorized" → aguarda próxima notificação

    // Marca evento como processado
    await admin
      .from("webhook_events")
      .update({ processed: true })
      .eq("id", eventKey);
  } catch (e) {
    console.error("[webhook] erro ao processar pagamento:", e);
    return new Response("Internal Error", { status: 500 });
  }

  return new Response("OK", { status: 200 });
}
