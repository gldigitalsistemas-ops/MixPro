import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { supabaseAdmin } from "@/lib/supabase/server";
import { publicEnv } from "@/lib/public-env";

/** Integração com o Mercado Pago (Checkout Pro) pela API REST — PIX, cartão e boleto. */
const API = "https://api.mercadopago.com";

function token(): string {
  const t = process.env.MP_ACCESS_TOKEN;
  if (!t) throw new Error("MP_ACCESS_TOKEN não configurado");
  return t;
}

async function mp<T>(path: string, init: RequestInit & { idempotencyKey?: string } = {}): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token()}`,
      "Content-Type": "application/json",
      ...(init.idempotencyKey ? { "X-Idempotency-Key": init.idempotencyKey } : {}),
    },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Mercado Pago ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.json() as Promise<T>;
}

export type Checkout = { orderId: string; initPoint: string };

/**
 * Cria o pedido no banco e a preferência de pagamento no Mercado Pago.
 * `packId` = "credits:<n>" para créditos ou "pro:<id do pedido>" para mixagem profissional.
 */
export async function createCheckout(opts: {
  userId: string;
  email: string | null;
  packId: string;
  title: string;
  quantity: number;
  unitPrice: number;
  credits: number;
  returnPath: string;
}): Promise<Checkout> {
  const admin = supabaseAdmin();
  const amount = Math.round(opts.quantity * opts.unitPrice * 100) / 100;
  const { data: order, error } = await admin
    .from("payment_orders")
    .insert({ user_id: opts.userId, pack_id: opts.packId, amount_brl: amount, credits_amount: Math.max(1, opts.credits) })
    .select("id, mp_external_ref")
    .single();
  if (error || !order) throw new Error("Erro ao criar pedido");

  const base = publicEnv.appUrl.replace(/\/$/, "");
  const back = (status: string) => `${base}${opts.returnPath}${opts.returnPath.includes("?") ? "&" : "?"}pagamento=${status}`;
  try {
    const pref = await mp<{ id: string; init_point: string }>("/checkout/preferences", {
      method: "POST",
      idempotencyKey: order.id,
      body: JSON.stringify({
        items: [
          {
            id: opts.packId,
            title: opts.title,
            quantity: opts.quantity,
            unit_price: opts.unitPrice,
            currency_id: "BRL",
          },
        ],
        payer: opts.email ? { email: opts.email } : undefined,
        external_reference: order.mp_external_ref,
        notification_url: `${base}/api/payments/webhook`,
        back_urls: { success: back("sucesso"), pending: back("pendente"), failure: back("erro") },
        auto_return: "approved",
        statement_descriptor: "MIXPRO",
        expires: true,
        expiration_date_from: new Date().toISOString(),
        expiration_date_to: new Date(Date.now() + 24 * 3600_000).toISOString(),
      }),
    });
    await admin.from("payment_orders").update({ mp_preference_id: pref.id }).eq("id", order.id);
    return { orderId: order.id, initPoint: pref.init_point };
  } catch (e) {
    await admin.from("payment_orders").update({ status: "failed", failure_reason: String(e).slice(0, 300) }).eq("id", order.id);
    throw e;
  }
}

export type MpPayment = {
  id: number;
  status: string;
  external_reference: string | null;
  transaction_amount: number;
  currency_id: string;
};

export function getPayment(id: string): Promise<MpPayment> {
  return mp<MpPayment>(`/v1/payments/${encodeURIComponent(id)}`);
}

export type Settlement = "approved" | "failed" | "pending" | "ignored";

/**
 * Aplica o resultado de um pagamento consultado na API (idempotente): libera créditos ou a
 * mixagem profissional quando aprovado. Usado pelo webhook e pela confirmação na volta do checkout.
 */
export async function settlePayment(payment: MpPayment): Promise<Settlement> {
  const admin = supabaseAdmin();
  const ref = payment.external_reference ?? "";
  // cobranças do plano mensal também geram "pagamentos": são tratadas pelo aviso da assinatura
  const { data: order } = await admin.from("payment_orders").select("id").eq("mp_external_ref", ref).maybeSingle();
  if (!order) return "ignored";
  if (payment.status === "approved" && payment.currency_id === "BRL") {
    const { error } = await admin.rpc("approve_payment_order", {
      p_external_ref: ref,
      p_mp_payment_id: String(payment.id),
      p_idempotency_key: `mp_payment_${payment.id}`,
      p_amount_paid: payment.transaction_amount,
    });
    if (error) throw error;
    return "approved";
  }
  if (["rejected", "cancelled", "refunded", "charged_back"].includes(payment.status)) {
    await admin.rpc("fail_payment_order", { p_external_ref: ref, p_mp_payment_id: String(payment.id), p_reason: payment.status });
    return "failed";
  }
  return "pending";
}

export type CredentialStatus = { configured: boolean; ok: boolean; mode: "produção" | "teste" | null; account?: string; error?: string };

/** Confere se o Access Token está configurado e é aceito pelo Mercado Pago. */
export async function checkCredentials(): Promise<CredentialStatus> {
  const t = process.env.MP_ACCESS_TOKEN;
  if (!t) return { configured: false, ok: false, mode: null };
  const mode = t.startsWith("TEST-") ? "teste" : "produção";
  try {
    const me = await mp<{ id: number; nickname?: string; email?: string }>("/users/me");
    return { configured: true, ok: true, mode, account: me.nickname ?? me.email ?? String(me.id) };
  } catch (e) {
    return { configured: true, ok: false, mode, error: String(e).slice(0, 200) };
  }
}

/**
 * Assinatura x-signature do webhook: HMAC-SHA256 de "id:<data.id>;request-id:<x-request-id>;ts:<ts>;".
 * Mesmo sem ela o valor do pagamento é sempre confirmado consultando a API com o nosso token.
 */
export function verifyWebhookSignature(xSignature: string, xRequestId: string, dataId: string): boolean {
  const secret = process.env.MP_WEBHOOK_SECRET;
  if (!secret) return true;
  const parts = Object.fromEntries(
    xSignature.split(",").map((p) => {
      const [k, ...v] = p.trim().split("=");
      return [k, v.join("=")];
    }),
  );
  if (!parts.ts || !parts.v1) return false;
  const id = /^[a-z0-9]+$/i.test(dataId) ? dataId.toLowerCase() : dataId;
  let manifest = `id:${id};`;
  if (xRequestId) manifest += `request-id:${xRequestId};`;
  manifest += `ts:${parts.ts};`;
  const expected = createHmac("sha256", secret).update(manifest).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(parts.v1);
  return a.length === b.length && timingSafeEqual(a, b);
}

// -----------------------------------------------------------------------------
// Plano mensal (Mercado Pago Assinaturas / preapproval)
// -----------------------------------------------------------------------------
export type Plan = { id: string; name: string; credits: number; price: number };

export async function getPlans(): Promise<Plan[]> {
  const { data } = await supabaseAdmin().from("system_settings").select("value").eq("key", "subscription_plans").maybeSingle();
  return Array.isArray(data?.value) ? (data!.value as Plan[]) : [];
}

type Preapproval = { id: string; status: string; external_reference: string | null; init_point?: string };
type AuthorizedPayment = {
  id: number;
  preapproval_id: string;
  status: string;
  transaction_amount: number;
  currency_id?: string;
  payment?: { id: number; status: string } | null;
};

const SUB_STATUS: Record<string, string> = { authorized: "authorized", paused: "paused", cancelled: "cancelled", pending: "pending" };

/** Cria a assinatura "pendente" no Mercado Pago; o cliente autoriza no link devolvido. */
export async function createSubscription(opts: { userId: string; email: string; plan: Plan }): Promise<string> {
  const admin = supabaseAdmin();
  const { data: sub, error } = await admin
    .from("subscriptions")
    .insert({ user_id: opts.userId, plan_id: opts.plan.id, credits_per_cycle: opts.plan.credits, amount_brl: opts.plan.price })
    .select("id")
    .single();
  if (error || !sub) throw new Error("Erro ao criar assinatura");
  const base = publicEnv.appUrl.replace(/\/$/, "");
  try {
    const pre = await mp<Preapproval>("/preapproval", {
      method: "POST",
      idempotencyKey: sub.id,
      body: JSON.stringify({
        reason: `Mix Pro — ${opts.plan.name} (${opts.plan.credits} créditos por mês)`,
        external_reference: sub.id,
        payer_email: opts.email,
        auto_recurring: { frequency: 1, frequency_type: "months", transaction_amount: opts.plan.price, currency_id: "BRL" },
        back_url: `${base}/creditos?assinatura=retorno`,
        status: "pending",
      }),
    });
    await admin.from("subscriptions").update({ mp_preapproval_id: pre.id }).eq("id", sub.id);
    if (!pre.init_point) throw new Error("Mercado Pago não devolveu o link da assinatura");
    return pre.init_point;
  } catch (e) {
    await admin.from("subscriptions").update({ status: "cancelled" }).eq("id", sub.id);
    throw e;
  }
}

export function getPreapproval(id: string): Promise<Preapproval> {
  return mp<Preapproval>(`/preapproval/${encodeURIComponent(id)}`);
}

/** Atualiza o status local da assinatura a partir do Mercado Pago. */
export async function syncSubscription(pre: Preapproval): Promise<void> {
  const status = SUB_STATUS[pre.status];
  if (!status) return;
  await supabaseAdmin().from("subscriptions").update({ status }).eq("mp_preapproval_id", pre.id);
}

/** Credita uma cobrança mensal aprovada (idempotente). */
export async function settleAuthorizedPayment(ap: AuthorizedPayment): Promise<Settlement> {
  const paid = ap.status === "processed" && (!ap.payment || ap.payment.status === "approved");
  if (!paid) return ["recycling", "scheduled", "pending"].includes(ap.status) ? "pending" : "failed";
  if (ap.currency_id && ap.currency_id !== "BRL") return "ignored";
  const { error } = await supabaseAdmin().rpc("apply_subscription_payment", {
    p_preapproval_id: ap.preapproval_id,
    p_auth_payment_id: String(ap.id),
    p_amount_paid: ap.transaction_amount,
  });
  if (error) {
    if (String(error.message).includes("SUBSCRIPTION_NOT_FOUND")) return "ignored";
    throw error;
  }
  return "approved";
}

export function getAuthorizedPayment(id: string): Promise<AuthorizedPayment> {
  return mp<AuthorizedPayment>(`/authorized_payments/${encodeURIComponent(id)}`);
}

/** Cobranças já feitas de uma assinatura (para creditar na volta, sem esperar o webhook). */
export async function listAuthorizedPayments(preapprovalId: string): Promise<AuthorizedPayment[]> {
  const r = await mp<{ results?: AuthorizedPayment[] }>(`/authorized_payments/search?preapproval_id=${encodeURIComponent(preapprovalId)}`);
  return r.results ?? [];
}

export async function cancelPreapproval(id: string): Promise<void> {
  await mp(`/preapproval/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify({ status: "cancelled" }) });
}
