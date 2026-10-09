/**
 * JobStore no Supabase (fatia 4): fala só com as RPCs de supabase/migrations/20261007000001_export_jobs.sql,
 * com a chave service_role (que fica no servidor: Secret Manager no Cloud Run, nunca no cliente).
 * Mesma interface do LocalJobStore: o pipeline não muda. O job continua vindo do banco.
 *
 * Erros das RPCs chegam como exceção do Postgres com um CÓDIGO FECHADO na mensagem
 * (RATE_LIMITED, CAPACITY, INSUFFICIENT_CREDITS…); qualquer outra coisa vira INTERNAL.
 */
import { ERROR_CODES, JobError, type ErrorCode } from "../errors";
import { logDiag } from "../log";
import type { JobCost, JobMeasures, JobObserved, JobRecord, JobStore, StartOutcome } from "./jobs";

type Row = Record<string, unknown>;

const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));

/** Linha de export_jobs → JobRecord da interface. */
export function toRecord(r: Row): JobRecord {
  const done = r.status === "done";
  const measures: JobMeasures | null = done
    ? {
        duration_s: num(r.duration_s) ?? 0,
        samples: num(r.samples) ?? 0,
        channels: num(r.channels) ?? 0,
        sample_rate: num(r.sample_rate) ?? 0,
        lufs: num(r.lufs) ?? 0,
        peak: num(r.peak) ?? 0,
        sha256_f32: String(r.sha256_f32 ?? ""),
        content_fingerprint: String(r.content_fingerprint ?? ""),
        input_sha256_f32: String(r.input_sha256_f32 ?? ""),
        output_bytes: num(r.output_bytes) ?? 0,
      }
    : null;
  const cost: JobCost | null =
    r.cpu_ms === null || r.cpu_ms === undefined
      ? null
      : { cpu_ms: num(r.cpu_ms) ?? 0, rss_mb: num(r.peak_rss_mb) ?? 0, wall_ms: num(r.wall_ms) ?? 0, etapas_ms: (r.etapas_ms as Record<string, number>) ?? {} };
  return {
    id: String(r.id),
    user_id: String(r.user_id),
    status: r.status as JobRecord["status"],
    progress: num(r.progress) ?? 0,
    credit_state: r.credit_state as JobRecord["credit_state"],
    job_json: (r.job_text as string | null) ?? null,
    input_key: String(r.input_key ?? ""),
    output_key: (r.output_key as string | null) ?? null,
    error_code: (r.error_code as ErrorCode | null) ?? null,
    measures,
    cost,
    attempts: num(r.attempts) ?? 0,
    // o banco não conta commits: a idempotência é garantida pela RPC (done não muda mais)
    commits: done ? 1 : 0,
    created_at: String(r.created_at),
    started_at: (r.started_at as string | null) ?? null,
    finished_at: (r.finished_at as string | null) ?? null,
    expires_at: String(r.expires_at),
  };
}

/** Erro de RPC com o código fechado (nunca o texto do banco). */
export class RpcError extends Error {
  constructor(public code: ErrorCode | "INVALID_JOB" | "INTERNAL") {
    super(code);
    this.name = "RpcError";
  }
}

export type CreateArgs = { user_id: string; idempotency_ref: string; target: string; job_json: string; input_key: string; platform?: string | null };

export class SupabaseJobStore implements JobStore {
  constructor(
    private url: string,
    private serviceKey: string,
  ) {}

  private async rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
    let res: Response;
    try {
      res = await fetch(`${this.url.replace(/\/$/, "")}/rest/v1/rpc/${fn}`, {
        method: "POST",
        headers: { apikey: this.serviceKey, Authorization: `Bearer ${this.serviceKey}`, "Content-Type": "application/json" },
        body: JSON.stringify(args),
      });
    } catch {
      logDiag("banco_sem_conexao", { funcao: fn });
      throw new RpcError("INTERNAL");
    }
    const text = await res.text();
    if (!res.ok) {
      let message = "";
      try {
        message = String((JSON.parse(text) as { message?: unknown }).message ?? "");
      } catch {}
      const code = (ERROR_CODES as readonly string[]).includes(message) ? (message as ErrorCode) : message === "INVALID_JOB" ? "INVALID_JOB" : "INTERNAL";
      // diagnóstico sem conteúdo: só a função e o status (401 = chave errada; 404 = função/URL)
      if (code === "INTERNAL") logDiag("banco_falhou", { funcao: fn, http: res.status });
      throw new RpcError(code);
    }
    return (text ? JSON.parse(text) : null) as T;
  }

  /** Só a rota da Vercel cria jobs (aqui para testes e para o enfileiramento de ponta a ponta). */
  create(a: CreateArgs) {
    return this.rpc<{ job_id: string; outcome: "created" | "existing" | "done"; status: string; credit_state: string }>("create_export_job", {
      p_user: a.user_id,
      p_ref: a.idempotency_ref,
      p_target: a.target,
      p_job: a.job_json,
      p_input_key: a.input_key,
      p_platform: a.platform ?? null,
    });
  }

  async get(id: string) {
    const r = await this.rpc<Row | null>("get_export_job", { p_job_id: id });
    return r ? toRecord(r) : null;
  }

  async start(id: string, staleMs: number): Promise<StartOutcome> {
    const r = await this.rpc<{ outcome: StartOutcome["outcome"]; job?: Row }>("start_export_job", { p_job_id: id, p_stale_seconds: Math.round(staleMs / 1000) });
    const record = r.job ? toRecord(r.job) : null;
    return r.outcome === "started" ? { outcome: "started", record: record! } : { outcome: r.outcome, record };
  }

  async reportProgress(id: string, pct: number) {
    await this.rpc("report_export_progress", { p_job_id: id, p_pct: Math.round(pct) });
  }

  async commit(id: string, c: { output_key: string; measures: JobMeasures; cost: JobCost }) {
    const r = await this.rpc<{ status: string; error_code?: ErrorCode }>("commit_export_credit", {
      p_job_id: id,
      p_output_key: c.output_key,
      p_measures: c.measures,
      p_cost: c.cost,
    });
    // a RPC já marcou o job como failed (REF_MISMATCH / INSUFFICIENT_CREDITS): o pipeline não entrega
    if (r.status !== "done") throw new JobError(r.error_code ?? "INTERNAL");
    return (await this.get(id))!;
  }

  async release(id: string, code: ErrorCode, cost?: JobCost, observed?: JobObserved) {
    await this.rpc("release_export_credit", { p_job_id: id, p_code: code, p_cost: cost ?? null, p_observed: observed ?? null });
    return this.get(id);
  }

  async requeue(id: string) {
    await this.rpc("requeue_export_job", { p_job_id: id });
  }

  /** Cancelamento pelo usuário (a rota confere a sessão e passa o uid; job de outro usuário = JOB_NOT_FOUND). */
  cancel(id: string, userId: string) {
    return this.rpc<{ status: string; credit_state: string; cancelled: boolean }>("cancel_export_job", { p_job_id: id, p_user: userId });
  }

  cleanup(staleSeconds = 1800, queuedSeconds = 900) {
    return this.rpc<{ parados: number; fila_antiga: number; expirados: number }>("cleanup_export_jobs", { p_stale_seconds: staleSeconds, p_queued_seconds: queuedSeconds });
  }
}
