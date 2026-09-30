import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase/server";
import { jsonError } from "@/lib/errors";
import { withUser } from "@/lib/api";
import { cancelPreapproval } from "@/lib/payments";

const bodySchema = z.object({ confirm: z.literal("EXCLUIR") });

/**
 * Exclusão da conta pelo próprio usuário (LGPD): cancela o plano mensal, apaga dados pessoais,
 * presets e preferências e desativa o login. Os registros de pagamento continuam (obrigação
 * legal/fiscal), sem nome e com o e-mail substituído.
 */
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  return withUser(async (userId) => {
    if (!bodySchema.safeParse(body).success) return jsonError(400, "Digite EXCLUIR para confirmar.");
    const admin = supabaseAdmin();

    // 1. plano mensal: para de cobrar
    const { data: subs } = await admin
      .from("subscriptions")
      .select("id, mp_preapproval_id")
      .eq("user_id", userId)
      .in("status", ["authorized", "paused", "pending"]);
    for (const s of subs ?? []) {
      try {
        if (s.mp_preapproval_id) await cancelPreapproval(s.mp_preapproval_id as string);
      } catch (e) {
        console.error("[account delete] cancelar plano", e);
        return jsonError(502, "Não foi possível cancelar o seu plano mensal agora. Tente de novo em instantes.");
      }
      await admin.from("subscriptions").update({ status: "cancelled" }).eq("id", s.id);
    }

    // 2. dados pessoais e preferências
    await Promise.all([
      admin.from("favorites").delete().eq("user_id", userId),
      admin.from("user_styles").delete().eq("user_id", userId),
      admin.from("user_presets").delete().eq("user_id", userId),
      admin.from("analytics_events").update({ user_id: null }).eq("user_id", userId),
    ]);
    await admin.from("profiles").update({ display_name: null, avatar_url: null, blocked_at: new Date().toISOString() }).eq("id", userId);

    // 3. login desativado e e-mail substituído (sem enviar e-mail de confirmação)
    const { error } = await admin.auth.admin.updateUserById(userId, {
      email: `excluido-${userId}@contas-excluidas.invalid`,
      email_confirm: true,
      user_metadata: {},
      ban_duration: "876600h",
    });
    if (error) {
      console.error("[account delete] auth", error);
      return jsonError(500, "Não foi possível concluir a exclusão. Fale com o atendimento.");
    }
    return Response.json({ ok: true });
  });
}
