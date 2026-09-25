import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase/server";
import { presignUpload } from "@/lib/storage";
import { jsonError } from "@/lib/errors";
import { withUser } from "@/lib/api";

const MIME: Record<string, string> = {
  wav: "audio/wav", aiff: "audio/aiff", aif: "audio/aiff", flac: "audio/flac",
};

const bodySchema = z.object({
  order_id: z.uuid(),
  file_name: z.string().min(1).max(200),
  size_bytes: z.number().int().positive(),
});

/** Inicia upload de um stem para um pedido profissional. */
export async function POST(req: Request) {
  return withUser(async (userId) => {
    const parsed = bodySchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return jsonError(400, "Dados inválidos.");
    const { order_id, file_name, size_bytes } = parsed.data;

    const admin = supabaseAdmin();

    const { data: order } = await admin.from("pro_orders").select("id,user_id,stems_prefix,service_id").eq("id", order_id).maybeSingle();
    if (!order || order.user_id !== userId) return jsonError(404, "Pedido não encontrado.");
    if (!["pending_payment", "paid"].includes((order as Record<string, unknown>).status as string)) return jsonError(400, "Pedido não aceita mais stems.");

    const ext = file_name.split(".").pop()?.toLowerCase() ?? "";
    const { data: fmtSetting } = await admin.from("system_settings").select("value").eq("key", "pro_stem_formats").single();
    const allowed = (fmtSetting?.value ?? ["wav", "aiff", "aif", "flac"]) as string[];
    if (!allowed.includes(ext) || !MIME[ext]) return jsonError(400, `Formato não suportado. Envie ${allowed.join(", ").toUpperCase()}.`);

    const { data: sizeSetting } = await admin.from("system_settings").select("value").eq("key", "pro_stem_max_mb").single();
    const maxMb = Number(sizeSetting?.value ?? 200);
    if (size_bytes > maxMb * 1024 * 1024) return jsonError(400, `Stem excede o limite de ${maxMb} MB.`);

    const stemId = crypto.randomUUID();
    const key = `${order.stems_prefix}${stemId}.${ext}`;

    const { error } = await admin.from("pro_stems").insert({
      id: stemId,
      order_id,
      user_id: userId,
      storage_key: key,
      file_name,
      size_bytes,
      mime: MIME[ext],
    });
    if (error) return jsonError(500, "Erro ao registrar stem.");

    const url = await presignUpload(key, MIME[ext], size_bytes);
    return Response.json({ stem_id: stemId, upload_url: url });
  });
}
