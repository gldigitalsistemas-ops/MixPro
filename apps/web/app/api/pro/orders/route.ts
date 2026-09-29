import { z } from "zod";
import { getSession, supabaseAdmin } from "@/lib/supabase/server";
import { jsonError } from "@/lib/errors";
import { withUser } from "@/lib/api";
import { createCheckout } from "@/lib/payments";

const bodySchema = z.object({
  service_id: z.uuid(),
  project_name: z.string().trim().min(1).max(120),
  genre: z.string().trim().max(60).optional(),
  bpm: z.number().int().min(40).max(300).optional(),
  notes: z.string().trim().max(2000).optional(),
  files_url: z.url().startsWith("https://").max(500),
});

/** Cria o pedido de mixagem profissional e já devolve o link de pagamento. */
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  return withUser(async (userId) => {
    const parsed = bodySchema.safeParse(body);
    if (!parsed.success) return jsonError(400, "Confira os dados do pedido e o link dos arquivos.");
    const d = parsed.data;

    const admin = supabaseAdmin();
    const [{ data: svc }, { data: enabled }] = await Promise.all([
      admin.from("pro_services").select("id, name, price_brl, delivery_days").eq("id", d.service_id).eq("active", true).maybeSingle(),
      admin.from("system_settings").select("value").eq("key", "pro_mixing_enabled").maybeSingle(),
    ]);
    if (!svc) return jsonError(404, "Serviço não encontrado.");
    if (enabled && String(enabled.value) === "false") return jsonError(503, "Mixagem profissional temporariamente indisponível.");

    const { data: order, error } = await admin
      .from("pro_orders")
      .insert({
        user_id: userId,
        service_id: svc.id,
        project_name: d.project_name,
        genre: d.genre || null,
        bpm: d.bpm ?? null,
        notes: d.notes || null,
        files_url: d.files_url,
      })
      .select("id")
      .single();
    if (error || !order) return jsonError(500, "Erro ao criar o pedido.");

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
      return Response.json({ order_id: order.id, init_point: checkout.initPoint });
    } catch (e) {
      console.error("[pro checkout]", e);
      return Response.json({ order_id: order.id, init_point: null });
    }
  });
}
