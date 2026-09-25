import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase/server";
import { jsonError } from "@/lib/errors";
import { withUser } from "@/lib/api";

const bodySchema = z.object({
  source_file_id: z.string().uuid(),
  model: z.enum(["htdemucs", "mdx", "mdx_q"]).default("htdemucs"),
  stems: z.enum(["2", "4", "6"]).default("4"),
});

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  return withUser(async (userId) => {
    const parsed = bodySchema.safeParse(body);
    if (!parsed.success) return jsonError(400, "Dados inválidos.");

    const admin = supabaseAdmin();

    // Verifica se o AI Lab está habilitado
    const { data: setting } = await admin.from("system_settings").select("value").eq("key", "ai_lab_stem_enabled").single();
    if (!setting?.value) return jsonError(503, "Separação de stems ainda não está disponível.");

    // Verifica se o arquivo pertence ao usuário
    const { data: file } = await admin.from("audio_files").select("id,user_id,status").eq("id", parsed.data.source_file_id).maybeSingle();
    if (!file || file.user_id !== userId) return jsonError(404, "Arquivo não encontrado.");
    if (file.status !== "ready") return jsonError(400, "Arquivo não está pronto para processamento.");

    // Cria o job via RPC (desconta créditos atomicamente)
    const { data: jobId, error } = await admin.rpc("enqueue_ai_job", {
      p_user: userId,
      p_type: "ai_stem_separate",
      p_source_file: parsed.data.source_file_id,
      p_params: { model: parsed.data.model, stems: Number(parsed.data.stems) },
    });

    if (error) {
      if (error.message.includes("INSUFFICIENT")) return jsonError(402, "Créditos insuficientes.");
      return jsonError(500, "Erro ao criar job.");
    }

    return Response.json({ job_id: jobId });
  });
}
