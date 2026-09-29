import { getSession, supabaseAdmin } from "@/lib/supabase/server";
import { jsonError } from "@/lib/errors";
import { withUser } from "@/lib/api";
import { createCheckout } from "@/lib/payments";

/** Novo link de pagamento para um pedido que ainda não foi pago. */
export async function POST(_req: Request, ctx: RouteContext<"/api/pro/orders/[id]/pay">) {
  const { id } = await ctx.params;
  return withUser(async (userId) => {
    const admin = supabaseAdmin();
    const { data: order } = await admin
      .from("pro_orders")
      .select("id, user_id, status, pro_services(name, price_brl)")
      .eq("id", id)
      .maybeSingle();
    if (!order || order.user_id !== userId) return jsonError(404, "Pedido não encontrado.");
    if (order.status !== "pending_payment") return jsonError(400, "Este pedido já foi pago.");
    const svc = order.pro_services as unknown as { name: string; price_brl: number };

    const session = await getSession();
    try {
      const checkout = await createCheckout({
        userId,
        email: session?.email ?? null,
        packId: `pro:${order.id}`,
        title: `Mix Pro — ${svc.name}`,
        quantity: 1,
        unitPrice: Number(svc.price_brl),
        credits: 1,
        returnPath: `/mixagem-profissional/pedidos/${order.id}`,
      });
      return Response.json({ init_point: checkout.initPoint });
    } catch (e) {
      console.error("[pro pay]", e);
      return jsonError(502, "Não foi possível abrir o pagamento agora. Tente novamente.");
    }
  });
}
