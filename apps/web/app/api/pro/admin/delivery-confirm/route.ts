import { z } from "zod";
import { requireAdmin, supabaseAdmin } from "@/lib/supabase/server";
import { jsonError } from "@/lib/errors";

const bodySchema = z.object({
  order_id: z.uuid(),
  delivery_key: z.string().min(1),
});

/** Admin: confirma entrega — atualiza delivery_key e muda status para waiting_revision. */
export async function POST(req: Request) {
  try { await requireAdmin(); } catch { return jsonError(403, "Acesso restrito."); }

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonError(400, "Dados inválidos.");

  const admin = supabaseAdmin();
  const { error } = await admin
    .from("pro_orders")
    .update({ delivery_key: parsed.data.delivery_key, status: "waiting_revision" })
    .eq("id", parsed.data.order_id);

  if (error) return jsonError(500, "Erro ao confirmar entrega.");
  return Response.json({ ok: true });
}
