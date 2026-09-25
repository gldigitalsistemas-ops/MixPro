import { supabaseAdmin } from "@/lib/supabase/server";
import { objectSize } from "@/lib/storage";
import { jsonError } from "@/lib/errors";
import { withUser } from "@/lib/api";

/** Confirma o upload (confere o objeto no storage) e enfileira a análise. */
export async function POST(_req: Request, ctx: RouteContext<"/api/uploads/[id]/complete">) {
  const { id } = await ctx.params;
  return withUser(async (userId) => {
    const admin = supabaseAdmin();
    const { data: file } = await admin
      .from("audio_files")
      .select("id,user_id,project_id,status,storage_key,size_bytes")
      .eq("id", id)
      .eq("user_id", userId)
      .maybeSingle();
    if (!file) return jsonError(404, "Arquivo não encontrado.");
    if (file.status !== "uploading") return Response.json({ ok: true, status: file.status });

    const size = await objectSize(file.storage_key);
    if (size == null) return jsonError(409, "O envio não foi concluído. Tente enviar novamente.");
    if (file.size_bytes && size !== file.size_bytes) {
      return jsonError(409, "O arquivo recebido está incompleto. Tente enviar novamente.");
    }

    await admin.from("audio_files").update({ status: "uploaded", size_bytes: size }).eq("id", id);
    const { data: job, error } = await admin
      .from("processing_jobs")
      .insert({
        user_id: userId,
        project_id: file.project_id,
        type: "analyze",
        priority: 1,
        source_file_id: id,
        stage: "Na fila",
      })
      .select("id")
      .single();
    if (error) return jsonError(500, "Não foi possível iniciar a análise do arquivo.");

    await admin.from("analytics_events").insert({ user_id: userId, event: "upload_completed", props: { file_id: id, size } });
    return Response.json({ ok: true, job_id: job.id });
  });
}
