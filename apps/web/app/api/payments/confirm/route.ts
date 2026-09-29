import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase/server";
import { jsonError } from "@/lib/errors";
import { withUser } from "@/lib/api";
import { getPayment, settlePayment } from "@/lib/payments";

const bodySchema = z.object({ payment_id: z.string().regex(/^\d{1,20}$/) });

/**
 * Na volta do checkout o Mercado Pago informa o payment_id: conferimos direto na API e
 * liberamos na hora, sem depender do webhook (que continua valendo como garantia).
 */
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  return withUser(async (userId) => {
    const parsed = bodySchema.safeParse(body);
    if (!parsed.success) return jsonError(400, "Pagamento inválido.");
    try {
      const payment = await getPayment(parsed.data.payment_id);
      const { data: order } = await supabaseAdmin()
        .from("payment_orders")
        .select("id")
        .eq("mp_external_ref", payment.external_reference ?? "")
        .eq("user_id", userId)
        .maybeSingle();
      if (!order) return jsonError(404, "Pagamento não encontrado.");
      return Response.json({ status: await settlePayment(payment) });
    } catch (e) {
      console.error("[confirm]", e);
      return jsonError(502, "Não foi possível confirmar agora. Os créditos entram automaticamente em instantes.");
    }
  });
}
