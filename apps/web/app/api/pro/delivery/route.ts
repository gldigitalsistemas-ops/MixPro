import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase/server";
import { presignDownload } from "@/lib/storage";
import { jsonError } from "@/lib/errors";
import { withUser } from "@/lib/api";

const querySchema = z.object({ order_id: z.uuid() });

/** Retorna URL assinada para download da entrega do pedido profissional. */
export async function GET(req: Request) {
  return withUser(async (userId) => {
    const url = new URL(req.url);
    const parsed = querySchema.safeParse({ order_id: url.searchParams.get("order_id") });
    if (!parsed.success) return jsonError(400, "order_id obrigatório.");

    const admin = supabaseAdmin();
    const { data: order } = await admin
      .from("pro_orders")
      .select("id,user_id,delivery_key,status")
      .eq("id", parsed.data.order_id)
      .maybeSingle();

    if (!order || order.user_id !== userId) return jsonError(404, "Pedido não encontrado.");
    if (!order.delivery_key) return jsonError(404, "Entrega ainda não disponível.");
    if (!["waiting_revision", "revision_requested", "delivered"].includes(order.status as string)) {
      return jsonError(403, "Entrega não liberada.");
    }

    const downloadUrl = await presignDownload(order.delivery_key as string, {
      expiresIn: 3600,
      fileName: `mixpro-entrega-${order.id.slice(0, 8)}.wav`,
    });
    return Response.json({ url: downloadUrl });
  });
}
