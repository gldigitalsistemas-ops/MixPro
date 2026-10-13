import webpush from "web-push";
import { supabaseAdmin } from "@/lib/supabase/server";
import { jobDoneMessage, validNotifyToken } from "@/lib/push/job-done";

export const maxDuration = 30;

/** Chamada só pelo serviço de processamento (assinada): avisa o dono que o job terminou. */
export async function POST(req: Request) {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const body = (await req.json().catch(() => null)) as { job_id?: unknown; token?: unknown } | null;
  const id = typeof body?.job_id === "string" && /^[0-9a-f-]{36}$/.test(body.job_id) ? body.job_id : null;
  if (!key || !id || !validNotifyToken(key, id, body?.token)) return new Response("não autorizado", { status: 401 });
  const pub = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT;
  if (!pub || !priv || !subject) return Response.json({ ok: true, enviado: 0, motivo: "VAPID não configurado" });

  const admin = supabaseAdmin();
  const { data: job } = await admin.from("tool_jobs").select("user_id,tool,status,params,project_id,wall_ms,finished_at").eq("id", id).maybeSingle();
  if (!job || !["done", "failed"].includes(job.status as string)) return Response.json({ ok: true, enviado: 0 });
  const msg = jobDoneMessage({
    tool: job.tool as string,
    status: job.status as "done" | "failed",
    preview: (job.params as { preview?: boolean } | null)?.preview === true,
    projectId: (job.project_id as string | null) ?? null,
    wallMs: Number(job.wall_ms ?? 0),
  });
  if (!msg) return Response.json({ ok: true, enviado: 0 });
  const { data: subs } = await admin.from("push_subscriptions").select("id,endpoint,p256dh,auth,failures").eq("user_id", job.user_id).limit(10);
  if (!subs?.length) return Response.json({ ok: true, enviado: 0 });
  webpush.setVapidDetails(subject, pub, priv);
  let sent = 0;
  const gone: string[] = [];
  await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint as string, keys: { p256dh: s.p256dh as string, auth: s.auth as string } }, JSON.stringify({ ...msg, tag: `job-${id}` }), { TTL: 6 * 3600, urgency: "high" });
        sent++;
      } catch (e) {
        const status = (e as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) gone.push(s.id as string);
      }
    }),
  );
  if (gone.length) await admin.from("push_subscriptions").delete().in("id", gone);
  return Response.json({ ok: true, enviado: sent });
}
