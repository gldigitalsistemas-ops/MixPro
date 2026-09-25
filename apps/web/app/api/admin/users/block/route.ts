import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase/server";
import { jsonError } from "@/lib/errors";
import { withAdmin } from "@/lib/api";

const bodySchema = z.object({
  user_id: z.string().uuid(),
  block: z.boolean(),
});

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  return withAdmin(async () => {
    const parsed = bodySchema.safeParse(body);
    if (!parsed.success) return jsonError(400, "Dados inválidos.");
    const { user_id, block } = parsed.data;

    const admin = supabaseAdmin();
    if (block) {
      await admin.auth.admin.updateUserById(user_id, { ban_duration: "876600h" });
      await admin.from("profiles").update({ blocked_at: new Date().toISOString() }).eq("id", user_id);
    } else {
      await admin.auth.admin.updateUserById(user_id, { ban_duration: "none" });
      await admin.from("profiles").update({ blocked_at: null }).eq("id", user_id);
    }
    return Response.json({ ok: true });
  });
}
