/**
 * Regras das rotas /api/export/jobs (Vercel). Fica separado dos handlers para ser testado com
 * dependências falsas. Nunca confia no cliente: o job é validado (schema estrito + p_ref
 * recalculado), o tamanho é limitado, e o dono do job é conferido em toda operação.
 *
 * Fluxo: create (valida, reserva crédito, devolve URL de envio) → o cliente envia o áudio direto ao R2
 * → start (confere o objeto e enfileira) → status (progresso, e a URL de download quando pronto).
 */
import { randomUUID } from "node:crypto";
import { SERVER_LIMITS } from "@mixpro/contracts";
import { validateServerJob } from "./server-validate";
import { exportErrorInfo } from "./error-messages";
import type { QueueService } from "./queue";
import { MAX_INPUT_BYTES } from "./server-limits";

export { MAX_INPUT_BYTES };
export const UPLOAD_URL_TTL_S = 900;
export const DOWNLOAD_URL_TTL_S = 60;

export type Rpc = (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>;
export type Objects = {
  presign(method: "GET" | "PUT", key: string, expiresS: number, opts?: { contentLength?: number; downloadName?: string }): string;
  head(key: string): Promise<{ size: number } | null>;
  delete(key: string): Promise<void>;
};
export type Deps = { rpc: Rpc; objects: Objects; queue: QueueService; newId?: () => string };

export type Fail = { ok: false; status: number; code: string; message: string; device: boolean };
export type Ok<T> = { ok: true } & T;

const fail = (code: string): Fail => {
  const i = exportErrorInfo(code);
  return { ok: false, status: i.status, code, message: i.message, device: i.device };
};

/** Código fechado da exceção do Postgres (a mensagem das RPCs é só o código). */
function rpcCode(error: { message: string }): string {
  const m = error.message.match(/\b(INSUFFICIENT_CREDITS|RATE_LIMITED|CAPACITY|INVALID_JOB|TOO_LARGE|JOB_NOT_FOUND|REF_MISMATCH)\b/);
  return m ? m[1] : "INTERNAL";
}

const PLATFORM = /^(ios|android|desktop|outro)\/(safari|chrome|firefox|outro)$/;

type JobRow = { id: string; user_id: string; status: string; progress: number; credit_state: string; input_key: string; output_key: string | null; error_code: string | null; expires_at?: string };

async function loadOwned(d: Deps, userId: string, jobId: string): Promise<JobRow | Fail> {
  if (!/^[0-9a-f-]{36}$/i.test(jobId)) return fail("JOB_NOT_FOUND");
  const { data, error } = await d.rpc("get_export_job", { p_job_id: jobId });
  const row = data as JobRow | null;
  // outro usuário recebe a mesma resposta de "não existe": nada indica que o job existe
  if (error || !row || row.user_id !== userId) return fail("JOB_NOT_FOUND");
  return row;
}

export async function createJob(
  d: Deps,
  userId: string,
  req: { body: string; inputBytes: number; platform?: string | null },
): Promise<Ok<{ jobId: string; outcome: "created" | "existing" | "done"; upload: { url: string; method: "PUT"; expiresInS: number } | null }> | Fail> {
  const v = validateServerJob(req.body);
  if (!v.ok) return fail(v.code);
  if (!Number.isInteger(req.inputBytes) || req.inputBytes < 1 || req.inputBytes > MAX_INPUT_BYTES) return fail("TOO_LARGE");
  if (v.job.source.duration_s > SERVER_LIMITS.maxDurationS) return fail("TOO_LONG");
  const platform = req.platform && PLATFORM.test(req.platform) ? req.platform : null;

  const inputKey = `in/${(d.newId ?? randomUUID)()}`;
  const { data, error } = await d.rpc("create_export_job", {
    p_user: userId,
    p_ref: v.job.idempotency_ref,
    p_target: v.job.output.target,
    p_job: req.body,
    p_input_key: inputKey,
    p_platform: platform,
  });
  if (error) return fail(rpcCode(error));
  const r = data as { job_id: string; outcome: "created" | "existing" | "done"; status: string };

  if (r.outcome === "done") return { ok: true, jobId: r.job_id, outcome: "done", upload: null };
  // criado agora: o envio vai para a chave nova; "existing": usa a chave do job que já está na fila
  let key = inputKey;
  if (r.outcome === "existing") {
    const row = await loadOwned(d, userId, r.job_id);
    if ("ok" in row) return row;
    if (row.status !== "queued") return { ok: true, jobId: r.job_id, outcome: "existing", upload: null };
    key = row.input_key;
  }
  return {
    ok: true,
    jobId: r.job_id,
    outcome: r.outcome,
    upload: { url: d.objects.presign("PUT", key, UPLOAD_URL_TTL_S, { contentLength: req.inputBytes }), method: "PUT", expiresInS: UPLOAD_URL_TTL_S },
  };
}

/** Confere que o áudio chegou ao R2 e enfileira. Pode ser chamado de novo sem duplicar a tarefa. */
export async function startJob(d: Deps, userId: string, jobId: string): Promise<Ok<{ status: string }> | Fail> {
  const row = await loadOwned(d, userId, jobId);
  if ("ok" in row) return row;
  if (row.status !== "queued") return { ok: true, status: row.status };
  const head = await d.objects.head(row.input_key);
  if (!head) return fail("INPUT_MISSING");
  if (head.size > MAX_INPUT_BYTES) {
    await d.objects.delete(row.input_key).catch(() => {});
    return fail("TOO_LARGE");
  }
  try {
    await d.queue.enqueue(jobId);
  } catch (e) {
    // nos logs da Vercel: só a etapa e o status HTTP (WifError/QueueError não carregam valores)
    console.error("[export] fila indisponível:", e instanceof Error ? e.message.slice(0, 120) : "erro");
    return fail("CAPACITY");
  }
  return { ok: true, status: "queued" };
}

export async function jobStatus(
  d: Deps,
  userId: string,
  jobId: string,
): Promise<Ok<{ status: string; progress: number; creditState: string; errorCode: string | null; message: string | null; device: boolean; downloadUrl: string | null }> | Fail> {
  const row = await loadOwned(d, userId, jobId);
  if ("ok" in row) return row;
  const info = row.error_code ? exportErrorInfo(row.error_code) : null;
  return {
    ok: true,
    status: row.status,
    progress: row.progress,
    creditState: row.credit_state,
    errorCode: row.error_code,
    message: info?.message ?? null,
    device: info?.device ?? false,
    downloadUrl:
      row.status === "done" && row.output_key && (!row.expires_at || new Date(row.expires_at).getTime() > Date.now())
        ? d.objects.presign("GET", row.output_key, DOWNLOAD_URL_TTL_S, { downloadName: `mixpro.${row.output_key.split(".").pop()}` })
        : null,
  };
}

export async function cancelJob(d: Deps, userId: string, jobId: string): Promise<Ok<{ status: string }> | Fail> {
  const row = await loadOwned(d, userId, jobId);
  if ("ok" in row) return row;
  const { error } = await d.rpc("cancel_export_job", { p_job_id: jobId, p_user: userId });
  if (error) return fail(rpcCode(error));
  await d.objects.delete(row.input_key).catch(() => {});
  return { ok: true, status: "failed" };
}

/** O servidor de exportação está ligado para este usuário (interruptor geral ou lista de liberados)? */
export async function serverEnabled(d: Pick<Deps, "rpc">, userId: string): Promise<boolean> {
  const { data, error } = await d.rpc("export_server_allowed", { p_user: userId });
  return !error && data === true;
}
