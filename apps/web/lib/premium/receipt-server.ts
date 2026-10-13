import "server-only";
import { supabaseAdmin } from "@/lib/supabase/server";
import { publicEnv } from "@/lib/public-env";
import { buildReceipt, sendEmail } from "./receipt";

/**
 * Manda o recibo de um pedido premium (uma vez). Nunca derruba o pagamento: qualquer falha vira "não enviou"
 * e libera a reserva para o próximo aviso do Mercado Pago tentar de novo. Pedidos de valor zero (admin) não geram recibo.
 */
export async function sendReceiptForOrder(orderId: string): Promise<boolean> {
  try {
    if (!process.env.RESEND_API_KEY || !process.env.RESEND_FROM) return false;
    const admin = supabaseAdmin();
    const { data: o } = await admin.from("premium_orders").select("id,user_id,project_id,product,price_brl,list_price_brl,intro,method,credits,status").eq("id", orderId).maybeSingle();
    // pedido de valor zero (conta admin) não gera recibo
    if (!o || o.status !== "paid" || Number(o.price_brl) <= 0) return false;
    const { data: claimed } = await admin.rpc("claim_premium_receipt", { p_order: orderId });
    if (claimed !== true) return false;
    const { data: u } = await admin.auth.admin.getUserById(o.user_id as string);
    const to = u.user?.email;
    if (!to) {
      await admin.rpc("release_premium_receipt", { p_order: orderId });
      return false;
    }
    const mail = buildReceipt(
      {
        product: o.product as string,
        priceBrl: Number(o.price_brl),
        listPriceBrl: Number(o.list_price_brl),
        intro: Boolean(o.intro),
        method: o.method as "brl" | "credits",
        credits: Number(o.credits),
        projectUrl: o.project_id ? `/premium/${o.project_id}` : null,
        orderId,
      },
      publicEnv.appUrl,
    );
    const ok = await sendEmail({ to, ...mail });
    if (!ok) await admin.rpc("release_premium_receipt", { p_order: orderId });
    return ok;
  } catch {
    return false;
  }
}
