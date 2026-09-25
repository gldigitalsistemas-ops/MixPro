import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase/server";
import { presignDownload } from "@/lib/storage";
import { jsonError } from "@/lib/errors";
import { withUser } from "@/lib/api";

const paramsSchema = z.object({ id: z.string().uuid() });

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!paramsSchema.safeParse({ id }).success) return jsonError(400, "ID inválido.");

  return withUser(async (userId) => {
    const admin = supabaseAdmin();
    const { data: job } = await admin
      .from("processing_jobs")
      .select("id,status,progress,stage,error_message,completed_at")
      .eq("id", id)
      .eq("user_id", userId)
      .maybeSingle();

    if (!job) return jsonError(404, "Job não encontrado.");

    let outputs: { stem_type: string; url: string; file_name: string }[] = [];
    if (job.status === "completed") {
      const { data: stems } = await admin
        .from("ai_stem_outputs")
        .select("stem_type,storage_key,file_name")
        .eq("job_id", id);

      outputs = await Promise.all(
        (stems ?? []).map(async (s) => ({
          stem_type: s.stem_type,
          file_name: s.file_name,
          url: s.storage_key
            ? await presignDownload(s.storage_key, { expiresIn: 3600, fileName: s.file_name })
            : "",
        }))
      );
    }

    return Response.json({
      id: job.id,
      status: job.status,
      progress: job.progress,
      stage: job.stage,
      error_message: job.error_message,
      completed_at: job.completed_at,
      outputs,
    });
  });
}
