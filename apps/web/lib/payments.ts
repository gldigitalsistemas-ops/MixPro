import "server-only";
import { MercadoPagoConfig, Preference, Payment } from "mercadopago";
import { supabaseAdmin } from "@/lib/supabase/server";

export type CreditPack = {
  id: string;
  label: string;
  brl: number;
  credits: number;
  highlight: boolean;
  badge?: string;
};

export function mpClient() {
  const token = process.env.MP_ACCESS_TOKEN;
  if (!token) throw new Error("MP_ACCESS_TOKEN não configurado");
  return new MercadoPagoConfig({ accessToken: token });
}

export async function getCreditPacks(): Promise<CreditPack[]> {
  const { data } = await supabaseAdmin()
    .from("system_settings")
    .select("value")
    .eq("key", "credit_packs")
    .single();
  return (data?.value ?? []) as CreditPack[];
}

export async function createPreference(
  pack: CreditPack,
  externalRef: string,
  appUrl: string,
) {
  const client = mpClient();
  const preference = new Preference(client);
  const body = {
    items: [
      {
        id: pack.id,
        title: `Mix Pro — ${pack.label}`,
        quantity: 1,
        unit_price: pack.brl,
        currency_id: "BRL",
      },
    ],
    external_reference: externalRef,
    back_urls: {
      success: `${appUrl}/app/creditos/sucesso`,
      failure: `${appUrl}/app/creditos/erro`,
      pending: `${appUrl}/app/creditos/pendente`,
    },
    auto_approve: false,
    notification_url: `${appUrl}/api/payments/webhook`,
    // Validade: 2 horas para completar o pagamento
    expiration_date_from: new Date().toISOString(),
    expiration_date_to: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
  } as Parameters<typeof preference.create>[0]["body"];

  const result = await preference.create({ body });
  return result;
}

export async function fetchMpPayment(paymentId: string) {
  const client = mpClient();
  const payment = new Payment(client);
  return payment.get({ id: paymentId });
}

/** Verifica assinatura do webhook do Mercado Pago (X-Signature). */
export function verifyWebhookSignature(
  xSignature: string,
  xRequestId: string,
  dataId: string,
  ts: string,
): boolean {
  const secret = process.env.MP_WEBHOOK_SECRET;
  if (!secret) return false;
  try {
    const { createHmac } = require("node:crypto") as typeof import("node:crypto");
    const manifest = `id:${dataId};request-id:${xRequestId};ts:${ts};`;
    const parts = xSignature.split(",");
    const v1 = parts.find((p) => p.startsWith("v1="))?.slice(3);
    if (!v1) return false;
    const expected = createHmac("sha256", secret).update(manifest).digest("hex");
    return expected === v1;
  } catch {
    return false;
  }
}
