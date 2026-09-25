import { supabaseAdmin } from "@/lib/supabase/server";
import { jsonError } from "@/lib/errors";
import { withUser } from "@/lib/api";

/** Marca um stem como pronto após upload confirmado. */
export async function POST(_req: Request, ctx: RouteContext<"/api/pro/stems/[id]/complete">) {
  return withUser(async (userId) => {
    const { id } = await ctx.params;
    const { error } = await supabaseAdmin()
      .from("pro_stems")
      .update({ status: "ready" })
      .eq("id", id)
      .eq("user_id", userId);

    if (error) return jsonError(500, "Erro ao confirmar stem.");
    return Response.json({ ok: true });
  });
}
