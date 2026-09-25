import { z } from "zod";
import { supabaseAdmin, supabaseServer } from "@/lib/supabase/server";
import { jsonError } from "@/lib/errors";
import { withUser } from "@/lib/api";

const bodySchema = z.object({
  service_id: z.uuid(),
  project_name: z.string().min(1).max(120),
  genre: z.string().max(60).optional(),
  bpm: z.number().int().min(40).max(300).optional(),
  notes: z.string().max(2000).optional(),
});

/** Cria pedido de mixagem profissional (sem pagamento ainda). */
export async function POST(req: Request) {
  return withUser(async (userId) => {
    const parsed = bodySchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return jsonError(400, "Dados inválidos.");

    const admin = supabaseAdmin();
    const { data: svc } = await admin.from("pro_services").select("id,price_brl,delivery_days").eq("id", parsed.data.service_id).eq("active", true).maybeSingle();
    if (!svc) return jsonError(404, "Serviço não encontrado.");

    const { enabled } = await admin.from("system_settings").select("value").eq("key", "pro_mixing_enabled").single().then(({ data }) => ({ enabled: data?.value === true || data?.value === "true" }));
    if (!enabled) return jsonError(503, "Mixagem profissional temporariamente indisponível.");

    const due = new Date();
    due.setDate(due.getDate() + (svc.delivery_days as number));

    const { data: order, error } = await admin.from("pro_orders").insert({
      user_id: userId,
      service_id: parsed.data.service_id,
      project_name: parsed.data.project_name,
      genre: parsed.data.genre ?? null,
      bpm: parsed.data.bpm ?? null,
      notes: parsed.data.notes ?? null,
      due_date: due.toISOString().split("T")[0],
      stems_prefix: `pro-orders/`,  // será completado após inserção
    }).select().single();

    if (error || !order) return jsonError(500, "Erro ao criar pedido.");

    // Atualiza prefix com o id do pedido
    await admin.from("pro_orders").update({ stems_prefix: `pro-orders/${order.id}/stems/` }).eq("id", order.id);

    return Response.json({ order_id: order.id, price_brl: svc.price_brl, due_date: due.toISOString().split("T")[0] });
  });
}
