import { supabaseAdmin } from "@/lib/supabase/server";
import { jsonError } from "@/lib/errors";
import { withUser } from "@/lib/api";
import { getPreapproval, listAuthorizedPayments, settleAuthorizedPayment, syncSubscription } from "@/lib/payments";

/** Na volta do Mercado Pago: sincroniza o plano e credita a primeira cobrança sem esperar o webhook. */
export async function POST() {
  return withUser(async (userId) => {
    const { data: sub } = await supabaseAdmin()
      .from("subscriptions")
      .select("id, mp_preapproval_id")
      .eq("user_id", userId)
      .not("mp_preapproval_id", "is", null)
      .in("status", ["pending", "authorized"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!sub) return Response.json({ status: "none" });
    try {
      const pre = await getPreapproval(sub.mp_preapproval_id as string);
      if (pre.external_reference !== sub.id) return jsonError(409, "Assinatura divergente.");
      await syncSubscription(pre);
      for (const ap of await listAuthorizedPayments(pre.id)) await settleAuthorizedPayment(ap);
      return Response.json({ status: pre.status });
    } catch (e) {
      console.error("[subscription confirm]", e);
      return jsonError(502, "Não foi possível confirmar agora. O plano é ativado automaticamente em instantes.");
    }
  });
}
