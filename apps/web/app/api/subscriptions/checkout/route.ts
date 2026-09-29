import { z } from "zod";
import { getSession, supabaseAdmin } from "@/lib/supabase/server";
import { jsonError } from "@/lib/errors";
import { withUser } from "@/lib/api";
import { createSubscription, getPlans } from "@/lib/payments";

const bodySchema = z.object({ plan_id: z.string().min(1).max(40) });

/** Assinatura do plano mensal: devolve o link para o cliente autorizar no Mercado Pago. */
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  return withUser(async (userId) => {
    const parsed = bodySchema.safeParse(body);
    if (!parsed.success) return jsonError(400, "Escolha um plano.");
    const plan = (await getPlans()).find((p) => p.id === parsed.data.plan_id);
    if (!plan) return jsonError(404, "Plano não encontrado.");

    const { data: active } = await supabaseAdmin()
      .from("subscriptions")
      .select("id")
      .eq("user_id", userId)
      .eq("status", "authorized")
      .maybeSingle();
    if (active) return jsonError(409, "Você já tem um plano ativo.");

    const session = await getSession();
    if (!session?.email) return jsonError(400, "Sua conta precisa de um e-mail para assinar.");
    try {
      return Response.json({ init_point: await createSubscription({ userId, email: session.email, plan }) });
    } catch (e) {
      console.error("[subscription]", e);
      return jsonError(502, "Não foi possível abrir a assinatura agora. Tente novamente em instantes.");
    }
  });
}
