import { withUser } from "@/lib/api";
import { getSession } from "@/lib/supabase/server";
import { wifConfigFromEnv } from "@/lib/export/gcp-wif";
import { cloudTasksConfigFromEnv } from "@/lib/export/queue-cloud-tasks";
import { r2ConfigFromEnv } from "@/lib/export/r2";
import { exportDeps, testGoogleAuth } from "@/lib/export/server-deps";

/** Por que o servidor não está disponível (só nomes de variáveis e etapas, nunca valores). */
function missing(): string[] {
  const out: string[] = [];
  try {
    r2ConfigFromEnv();
  } catch {
    out.push("R2_ACCOUNT_ID/R2_ACCESS_KEY_ID/R2_SECRET_ACCESS_KEY/R2_BUCKET");
  }
  try {
    cloudTasksConfigFromEnv();
  } catch {
    out.push("GCP_PROJECT_ID/GCP_REGION/EXPORT_TASKS_QUEUE/EXPORT_SERVICE_URL");
  }
  if (!process.env.GCP_SERVICE_ACCOUNT_JSON && !wifConfigFromEnv())
    out.push(process.env.GCP_WIF_PROVIDER ? "GCP_WIF_PROVIDER existe, mas o valor não está no formato //iam.googleapis.com/projects/<número>/locations/global/workloadIdentityPools/<pool>/providers/<provider>" : "GCP_WIF_PROVIDER (ou GCP_SERVICE_ACCOUNT_JSON)");
  return out;
}

/**
 * O app só tenta o servidor quando ele está configurado e liberado para esta conta.
 * Para administradores, a resposta traz o motivo quando está desligado (diagnóstico).
 */
export async function GET(req: Request) {
  return withUser(async (userId) => {
    const session = await getSession();
    const admin = (session?.profile as { role?: string } | undefined)?.role === "admin";
    const gaps = missing();
    const oidc = Boolean(req.headers.get("x-vercel-oidc-token") || process.env.VERCEL_OIDC_TOKEN);
    if (gaps.length) return Response.json(admin ? { enabled: false, motivo: "variáveis ausentes neste ambiente", faltam: gaps } : { enabled: false });
    let allowed = false;
    try {
      const { data, error } = await exportDeps(req).rpc("export_server_allowed", { p_user: userId });
      if (error) return Response.json(admin ? { enabled: false, motivo: "o banco recusou a consulta (a migração export_jobs foi aplicada?)" } : { enabled: false });
      allowed = data === true;
    } catch {
      return Response.json({ enabled: false });
    }
    if (!allowed) return Response.json(admin ? { enabled: false, motivo: "sua conta não está em export_server_users e o interruptor geral está desligado" } : { enabled: false });
    if (!admin) return Response.json({ enabled: true });
    // ?testar=1: confere a autenticação com o Google (o mesmo caminho usado para criar a tarefa na fila)
    const google = new URL(req.url).searchParams.get("testar") === "1" ? await testGoogleAuth(req) : undefined;
    return Response.json({ enabled: true, oidc_da_vercel: oidc || !wifConfigFromEnv(), google });
  });
}
