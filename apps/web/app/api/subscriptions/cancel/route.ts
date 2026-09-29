import { supabaseAdmin } from "@/lib/supabase/server";
import { jsonError } from "@/lib/errors";
import { withUser } from "@/lib/api";
import { cancelPreapproval } from "@/lib/payments";

/** Cancela o plano mensal (os créditos já recebidos continuam na conta). */
export async function POST() {
  return withUser(async (userId) => {
    const admin = supabaseAdmin();
    const { data: sub } = await admin
      .from("subscriptions")
      .select("id, mp_preapproval_id")
      .eq("user_id", userId)
      .in("status", ["authorized", "paused", "pending"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!sub) return jsonError(404, "Nenhum plano ativo.");
    try {
      if (sub.mp_preapproval_id) await cancelPreapproval(sub.mp_preapproval_id as string);
      await admin.from("subscriptions").update({ status: "cancelled" }).eq("id", sub.id);
      return Response.json({ ok: true });
    } catch (e) {
      console.error("[subscription cancel]", e);
      return jsonError(502, "Não foi possível cancelar agora. Tente de novo em instantes.");
    }
  });
}
