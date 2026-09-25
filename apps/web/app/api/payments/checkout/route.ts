import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase/server";
import { jsonError } from "@/lib/errors";
import { withUser } from "@/lib/api";
import { getCreditPacks, createPreference } from "@/lib/payments";

const bodySchema = z.object({ pack_id: z.string().min(1) });

/**
 * Cria uma preferência de pagamento no Mercado Pago e um payment_order no banco.
 * Retorna init_point (URL do checkout do MP) e sandbox_init_point para testes.
 */
export async function POST(req: Request) {
  return withUser(async (userId) => {
    const parsed = bodySchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return jsonError(400, "pack_id obrigatório.");

    const packs = await getCreditPacks();
    const pack = packs.find((p) => p.id === parsed.data.pack_id);
    if (!pack) return jsonError(404, "Pacote não encontrado.");

    const admin = supabaseAdmin();

    // Cria payment_order (obtém mp_external_ref)
    const { data: order, error: oErr } = await admin.rpc("create_payment_order", {
      p_pack_id: pack.id,
      p_amount_brl: pack.brl,
      p_credits: pack.credits,
    });
    if (oErr || !order) return jsonError(500, "Erro ao criar pedido.");

    // Chama a RPC como se fosse o usuário (auth.uid() precisa existir)
    // create_payment_order usa security definer com auth.uid() — precisamos
    // chamar via supabase do usuário. Recriamos usando admin direto.
    // Como é security definer e usa auth.uid(), usamos insert direto.
    const { data: row, error: rowErr } = await admin
      .from("payment_orders")
      .insert({
        user_id: userId,
        pack_id: pack.id,
        amount_brl: pack.brl,
        credits_amount: pack.credits,
      })
      .select()
      .single();
    if (rowErr || !row) return jsonError(500, "Erro ao criar pedido.");

    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

    let preference;
    try {
      preference = await createPreference(pack, row.mp_external_ref, appUrl);
    } catch (e) {
      // Falha ao criar preferência: marca pedido como falho e responde erro
      await admin.from("payment_orders").update({ status: "failed", failure_reason: String(e) }).eq("id", row.id);
      console.error("[checkout] MP preference error:", e);
      return jsonError(502, "Erro ao conectar com o Mercado Pago. Tente novamente.");
    }

    // Salva preference_id no pedido
    await admin
      .from("payment_orders")
      .update({ mp_preference_id: preference.id })
      .eq("id", row.id);

    return Response.json({
      order_id: row.id,
      init_point: preference.init_point,
      sandbox_init_point: preference.sandbox_init_point,
    });
  });
}
