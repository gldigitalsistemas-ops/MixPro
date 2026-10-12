import { supabaseAdmin } from "@/lib/supabase/server";

/** Conta uma reprodução (métrica da vitrine no admin). */
export async function POST(_req: Request, ctx: RouteContext<"/api/showcase/[id]/play">) {
  const { id } = await ctx.params;
  if (/^[0-9a-f-]{36}$/.test(id)) await supabaseAdmin().rpc("count_showcase_play", { p_item: id });
  return new Response(null, { status: 204 });
}
