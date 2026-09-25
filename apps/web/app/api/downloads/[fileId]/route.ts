import { supabaseServer } from "@/lib/supabase/server";
import { presignDownload } from "@/lib/storage";
import { friendlyError, jsonError } from "@/lib/errors";
import { withUser } from "@/lib/api";

/**
 * Autoriza o download: debita 1 crédito na primeira vez (ledger, atômico no banco)
 * e devolve uma URL assinada de curta duração. Re-download do mesmo resultado é grátis.
 */
export async function POST(_req: Request, ctx: RouteContext<"/api/downloads/[fileId]">) {
  const { fileId } = await ctx.params;
  return withUser(async (userId) => {
    const supabase = await supabaseServer();
    const { data, error } = await supabase.rpc("authorize_download", { p_file: fileId });
    if (error) {
      const status = error.message.includes("INSUFFICIENT_CREDITS") ? 402 : 400;
      return jsonError(status, friendlyError(error));
    }
    const res = data as { charged: boolean; storage_key: string; file_name: string | null; balance: number };
    const url = await presignDownload(res.storage_key, { fileName: res.file_name ?? "mixpro.wav", expiresIn: 300 });
    await supabase.from("analytics_events").insert({
      user_id: userId,
      event: "download_completed",
      props: { file_id: fileId, charged: res.charged },
    });
    return Response.json({ url, charged: res.charged, balance: res.balance });
  });
}
