/**
 * Falhas do servidor na mesma tela de "Logs de erros" do Admin (tabela app_errors, que antes só recebia erros do
 * navegador). Grava com a chave de serviço do Supabase (que o serviço já tem): recurso, etapa (progresso), código,
 * causa técnica e a pessoa afetada. Nunca derruba o job: se não gravar, segue em frente.
 */
import { createHash } from "node:crypto";

export type ServerFailure = {
  jobId: string;
  tool: string;
  userId: string | null;
  projectId: string | null;
  code: string;
  /** Exceção original (causa técnica) quando não foi um erro já previsto. */
  error: unknown;
  progress: number | null;
  attempt: number;
  /** Vai tentar de novo sozinho (aviso) ou desistiu (erro). */
  retrying: boolean;
};

export type ErrorReporter = (f: ServerFailure) => Promise<void>;

export function makeErrorReporter(o: { supabaseUrl: string; serviceKey: string; fetchFn?: typeof fetch }): ErrorReporter {
  const f = o.fetchFn ?? fetch;
  return async (x) => {
    const err = x.error instanceof Error ? x.error : null;
    const cause = err ? `${err.name}: ${err.message}`.slice(0, 300) : null;
    const message = `${x.tool}: ${x.code}${x.retrying ? " (vai tentar de novo)" : ""}`.slice(0, 500);
    const fingerprint = createHash("sha256").update(`servidor|${x.tool}|${x.code}|${err?.message?.replace(/[0-9a-f-]{36}/g, "") ?? ""}`).digest("hex").slice(0, 32);
    try {
      await f(`${o.supabaseUrl.replace(/\/$/, "")}/rest/v1/app_errors`, {
        method: "POST",
        headers: { apikey: o.serviceKey, Authorization: `Bearer ${o.serviceKey}`, "content-type": "application/json", Prefer: "return=minimal" },
        body: JSON.stringify({
          user_id: x.userId,
          client_id: "servidor-cloud-run",
          severity: x.retrying ? "aviso" : "erro",
          area: `servidor:${x.tool}`.slice(0, 40),
          fingerprint,
          message,
          cause,
          stack: err?.stack?.slice(0, 4000) ?? null,
          browser: "Servidor (Cloud Run)",
          route: x.projectId ? `/premium/${x.projectId}` : null,
          context: { job_id: x.jobId, codigo: x.code, progresso: x.progress, tentativa: x.attempt },
        }),
        signal: AbortSignal.timeout(4000),
      });
    } catch {
      // sem registro: o código do erro continua no job
    }
  };
}
