import { z } from "zod";
import { requireAdmin, supabaseAdmin } from "@/lib/supabase/server";
import { presignUpload } from "@/lib/storage";
import { jsonError } from "@/lib/errors";

const MIME: Record<string, string> = {
  wav: "audio/wav", flac: "audio/flac", mp3: "audio/mpeg", aiff: "audio/aiff", aif: "audio/aiff",
};

const bodySchema = z.object({
  order_id: z.uuid(),
  file_name: z.string().min(1).max(200),
  size_bytes: z.number().int().positive(),
});

/** Admin: gera URL assinada para upload da entrega final. */
export async function POST(req: Request) {
  try { await requireAdmin(); } catch { return jsonError(403, "Acesso restrito."); }

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonError(400, "Dados inválidos.");

  const admin = supabaseAdmin();
  const { data: order } = await admin.from("pro_orders").select("id").eq("id", parsed.data.order_id).maybeSingle();
  if (!order) return jsonError(404, "Pedido não encontrado.");

  const ext = parsed.data.file_name.split(".").pop()?.toLowerCase() ?? "wav";
  const mime = MIME[ext] ?? "audio/wav";
  const key = `pro-orders/${parsed.data.order_id}/delivery/${parsed.data.file_name}`;
  const url = await presignUpload(key, mime, parsed.data.size_bytes);
  return Response.json({ upload_url: url, delivery_key: key });
}
