import "server-only";
import { supabaseAdmin } from "@/lib/supabase/server";
import { CloudTasksQueue, cloudTasksConfigFromEnv, serviceAccountTokenSource } from "./queue-cloud-tasks";
import { R2Client, r2ConfigFromEnv } from "./r2";
import type { Deps, Fail } from "./server-jobs";

/**
 * Dependências reais das rotas /api/export/jobs: banco (RPCs com service role, só aqui no servidor),
 * R2 e Cloud Tasks. Criadas a cada pedido (leem as variáveis de ambiente quando usadas).
 */
export function exportDeps(): Deps {
  const r2 = new R2Client(r2ConfigFromEnv());
  const admin = supabaseAdmin();
  const sa = process.env.GCP_SERVICE_ACCOUNT_JSON;
  if (!sa) throw new Error("GCP_SERVICE_ACCOUNT_JSON ausente");
  return {
    rpc: async (fn, args) => {
      const { data, error } = await admin.rpc(fn, args);
      return { data, error: error ? { message: error.message } : null };
    },
    objects: {
      presign: (method, key, expiresS, opts) => r2.presign(method, key, expiresS, opts),
      head: (key) => r2.head(key),
      delete: (key) => r2.delete(key),
    },
    queue: new CloudTasksQueue(cloudTasksConfigFromEnv(), serviceAccountTokenSource(sa)),
  };
}

/** Falha de regra → resposta JSON com mensagem amigável, código fechado e se o aparelho pode assumir. */
export function failResponse(f: Fail) {
  return Response.json({ error: f.message, code: f.code, device: f.device }, { status: f.status });
}

/** Configuração incompleta (R2 ou GCP): o servidor de exportação não está disponível; o app usa o aparelho. */
export function unavailableResponse() {
  return Response.json({ error: "O processamento no servidor não está disponível agora. Você pode processar neste aparelho.", code: "CAPACITY", device: true }, { status: 503 });
}
