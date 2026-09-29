import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase/server";
import { jsonError } from "@/lib/errors";
import { withAdmin } from "@/lib/api";

const bodySchema = z.object({
  order_id: z.uuid(),
  status: z.enum(["paid", "in_progress", "waiting_revision", "delivered", "cancelled", "refunded"]).optional(),
  delivery_url: z.url().startsWith("https://").max(500).optional(),
  admin_notes: z.string().max(2000).optional(),
});

/** Admin: muda o status e/ou registra o link de entrega do pedido profissional. */
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  return withAdmin(async () => {
    const parsed = bodySchema.safeParse(body);
    if (!parsed.success) return jsonError(400, "Dados inválidos (o link precisa começar com https://).");
    const { order_id, ...patch } = parsed.data;
    const update: Record<string, unknown> = { ...patch };
    if (patch.delivery_url && !patch.status) update.status = "waiting_revision";
    if (update.status === "waiting_revision") update.delivered_at = new Date().toISOString();
    const { error } = await supabaseAdmin().from("pro_orders").update(update).eq("id", order_id);
    if (error) return jsonError(500, "Erro ao atualizar o pedido.");
    return Response.json({ ok: true });
  });
}
