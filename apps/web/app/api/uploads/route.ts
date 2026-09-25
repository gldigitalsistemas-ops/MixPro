import { z } from "zod";
import { supabaseAdmin, supabaseServer } from "@/lib/supabase/server";
import { presignUpload } from "@/lib/storage";
import { jsonError } from "@/lib/errors";
import { loadSettings, num, withUser } from "@/lib/api";

const MIME_BY_EXT: Record<string, string> = {
  wav: "audio/wav",
  mp3: "audio/mpeg",
  flac: "audio/flac",
  aiff: "audio/aiff",
  aif: "audio/aiff",
};

const bodySchema = z.object({
  project_id: z.uuid(),
  track_id: z.uuid().optional(),
  file_name: z.string().min(1).max(200),
  size_bytes: z.number().int().positive(),
});

/**
 * Inicia um upload: valida formato/tamanho/limites e devolve uma URL assinada
 * para o navegador enviar o arquivo direto ao storage (sem passar pela Vercel).
 */
export async function POST(req: Request) {
  return withUser(async (userId) => {
    const parsed = bodySchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return jsonError(400, "Dados de upload inválidos.");
    const { project_id, track_id, file_name, size_bytes } = parsed.data;

    const settings = await loadSettings();
    const allowed = (settings.allowed_formats as string[]) ?? Object.keys(MIME_BY_EXT);
    const ext = file_name.split(".").pop()?.toLowerCase() ?? "";
    if (!allowed.includes(ext) || !MIME_BY_EXT[ext]) {
      return jsonError(400, `Formato não suportado. Envie ${allowed.map((a) => a.toUpperCase()).join(", ")}.`);
    }
    const maxMb = num(settings, "max_upload_mb", 50);
    if (size_bytes > maxMb * 1024 * 1024) {
      return jsonError(400, `Este arquivo ultrapassa o limite de ${maxMb} MB.`);
    }

    // Projeto pertence ao usuário? (RLS no cliente do usuário)
    const supabase = await supabaseServer();
    const { data: project } = await supabase.from("projects").select("id").eq("id", project_id).is("deleted_at", null).maybeSingle();
    if (!project) return jsonError(404, "Projeto não encontrado.");

    const admin = supabaseAdmin();
    const since = new Date(Date.now() - 3600_000).toISOString();
    const { count } = await admin
      .from("audio_files")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("kind", "source")
      .gte("created_at", since);
    if ((count ?? 0) >= num(settings, "rate_uploads_per_hour", 60)) {
      return jsonError(429, "Muitos envios em pouco tempo. Aguarde alguns minutos.");
    }

    const fileId = crypto.randomUUID();
    const key = `users/${userId}/projects/${project_id}/sources/${fileId}.${ext}`;
    const { error } = await admin.from("audio_files").insert({
      id: fileId,
      user_id: userId,
      project_id,
      kind: "source",
      status: "uploading",
      storage_key: key,
      original_name: file_name,
      ext,
      mime: MIME_BY_EXT[ext],
      size_bytes,
    });
    if (error) return jsonError(500, "Não foi possível iniciar o envio.");

    if (track_id) {
      await supabase.from("tracks").update({ source_file_id: fileId }).eq("id", track_id);
    }

    const url = await presignUpload(key, MIME_BY_EXT[ext], size_bytes);
    return Response.json({ file_id: fileId, upload_url: url, content_type: MIME_BY_EXT[ext] });
  });
}
