import { withAdmin } from "@/lib/api";
import { supabaseAdmin } from "@/lib/supabase/server";
import { R2Client, r2ConfigFromEnv } from "@/lib/export/r2";
import { adminCreate } from "@/lib/premium/showcase";

/**
 * Admin da vitrine:
 *   POST { action: "review", id, approve }   aprova (credita o presente ao dono) ou recusa
 *   POST { action: "feature", id, featured }  destaca no topo
 *   POST { action: "delete", id }             remove (apaga os arquivos)
 *   POST { action: "create", ... }            exemplo próprio: devolve URLs para enviar os trechos
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  return withAdmin(async (adminId) => {
    const admin = supabaseAdmin();
    const id = typeof body?.id === "string" && /^[0-9a-f-]{36}$/.test(body.id) ? body.id : null;
    switch (body?.action) {
      case "review": {
        if (!id) break;
        const { data, error } = await admin.rpc("review_showcase_item", { p_item: id, p_approve: body.approve === true });
        return error ? Response.json({ error: "Não foi possível." }, { status: 500 }) : Response.json(data);
      }
      case "feature": {
        if (!id) break;
        await admin.from("showcase_items").update({ featured: body.featured === true }).eq("id", id);
        return Response.json({ ok: true });
      }
      case "delete": {
        if (!id) break;
        const { data } = await admin.from("showcase_items").select("before_key,after_key").eq("id", id).maybeSingle();
        if (data) {
          const r2 = new R2Client(r2ConfigFromEnv());
          for (const k of [data.before_key, data.after_key]) if (k) await r2.delete(k as string).catch(() => {});
          await admin.from("showcase_items").delete().eq("id", id);
        }
        return Response.json({ ok: true });
      }
      case "create": {
        const r = await adminCreate(adminId, body);
        return r.ok ? Response.json(r) : Response.json({ error: r.error }, { status: 400 });
      }
    }
    return Response.json({ error: "Ação inválida." }, { status: 400 });
  });
}
