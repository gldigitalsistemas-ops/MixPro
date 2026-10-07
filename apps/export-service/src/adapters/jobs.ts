/**
 * Estado dos jobs. Fatia 3: arquivo JSON local (no lugar do Supabase). A interface espelha as RPCs
 * do plano (ETAPA4_PLANO.md, seção 3.2): start_export_job, report_export_progress,
 * commit_export_credit e release_export_credit. Aqui o commit SÓ marca done: o débito real
 * (grant_credits com a chave export:uid:p_ref) é da fatia 4.
 */
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { ErrorCode } from "../errors";

export type JobStatus = "queued" | "running" | "done" | "failed" | "expired";
export type CreditState = "none" | "reserved" | "charged" | "released";

export type JobMeasures = {
  duration_s: number;
  samples: number;
  channels: number;
  sample_rate: number;
  lufs: number;
  peak: number;
  sha256_f32: string;
  /** signalFingerprint do áudio decodificado no servidor (âncora do p_ref, fatia 4). */
  content_fingerprint: string;
  output_bytes: number;
};

export type JobCost = { cpu_ms: number; rss_mb: number; wall_ms: number; etapas_ms: Record<string, number> };

export type JobRecord = {
  id: string;
  user_id: string;
  status: JobStatus;
  progress: number;
  credit_state: CreditState;
  /** O ExportJob como o cliente enviou (texto: a ordem das chaves entra no p_ref). */
  job_json: string | null;
  input_key: string;
  output_key: string | null;
  error_code: ErrorCode | null;
  measures: JobMeasures | null;
  cost: JobCost | null;
  attempts: number;
  /** Quantas vezes o commit foi aplicado de fato (deve ser 0 ou 1). */
  commits: number;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  expires_at: string;
};

export type StartOutcome =
  | { outcome: "started"; record: JobRecord }
  | { outcome: "done" | "failed" | "busy" | "missing"; record: JobRecord | null };

export interface JobStore {
  get(id: string): Promise<JobRecord | null>;
  /** queued → running (ou retoma um running parado há mais que staleMs). done/failed não reabrem. */
  start(id: string, staleMs: number): Promise<StartOutcome>;
  /** Só aumenta. */
  reportProgress(id: string, pct: number): Promise<void>;
  /** running → done com medidas e custo; idempotente (um segundo commit não muda nada). */
  commit(id: string, r: { output_key: string; measures: JobMeasures; cost: JobCost }): Promise<JobRecord>;
  /** queued/running → failed; nunca mexe num done. Apaga o JSON do job. */
  release(id: string, code: ErrorCode, cost?: JobCost): Promise<JobRecord | null>;
  /** running → queued para uma nova tentativa (falha passageira). */
  requeue(id: string): Promise<void>;
}

export class LocalJobStore implements JobStore {
  private lock: Promise<unknown> = Promise.resolve();

  constructor(private file: string) {}

  /** Uma operação por vez (o arquivo inteiro é relido e regravado). */
  private exclusive<T>(fn: (jobs: Record<string, JobRecord>) => T | Promise<T>, write: boolean): Promise<T> {
    const next = this.lock.then(async () => {
      let jobs: Record<string, JobRecord> = {};
      try {
        jobs = JSON.parse(await readFile(this.file, "utf8"));
      } catch {}
      const out = await fn(jobs);
      if (write) {
        await mkdir(dirname(this.file), { recursive: true });
        const tmp = `${this.file}.${randomUUID()}.tmp`;
        await writeFile(tmp, JSON.stringify(jobs, null, 1));
        await rename(tmp, this.file);
      }
      return out;
    });
    this.lock = next.catch(() => {});
    return next;
  }

  /** Só para testes e para o enfileiramento local (na fatia 4 é a RPC create_export_job). */
  create(r: Pick<JobRecord, "user_id" | "job_json" | "input_key"> & Partial<JobRecord>): Promise<JobRecord> {
    const now = new Date();
    const rec: JobRecord = {
      id: randomUUID(),
      status: "queued",
      progress: 0,
      credit_state: "reserved",
      output_key: null,
      error_code: null,
      measures: null,
      cost: null,
      attempts: 0,
      commits: 0,
      created_at: now.toISOString(),
      started_at: null,
      finished_at: null,
      expires_at: new Date(now.getTime() + 24 * 3600_000).toISOString(),
      ...r,
    };
    return this.exclusive((jobs) => (jobs[rec.id] = rec), true);
  }

  get(id: string) {
    return this.exclusive((jobs) => jobs[id] ?? null, false);
  }

  start(id: string, staleMs: number): Promise<StartOutcome> {
    return this.exclusive((jobs): StartOutcome => {
      const r = jobs[id];
      if (!r) return { outcome: "missing", record: null };
      if (r.status === "done") return { outcome: "done", record: r };
      if (r.status === "failed" || r.status === "expired") return { outcome: "failed", record: r };
      if (r.status === "running" && r.started_at && Date.now() - Date.parse(r.started_at) < staleMs) return { outcome: "busy", record: r };
      r.status = "running";
      r.attempts++;
      r.started_at = new Date().toISOString();
      return { outcome: "started", record: { ...r } };
    }, true);
  }

  reportProgress(id: string, pct: number) {
    return this.exclusive((jobs) => {
      const r = jobs[id];
      if (r && r.status === "running") r.progress = Math.max(r.progress, Math.min(100, Math.round(pct)));
    }, true);
  }

  commit(id: string, c: { output_key: string; measures: JobMeasures; cost: JobCost }) {
    return this.exclusive((jobs) => {
      const r = jobs[id];
      if (!r) throw new Error("job inexistente");
      if (r.status === "done") return { ...r };
      if (r.status !== "running") throw new Error("commit fora de running");
      Object.assign(r, { status: "done", progress: 100, output_key: c.output_key, measures: c.measures, cost: c.cost, finished_at: new Date().toISOString() });
      r.commits++;
      // decisão 13 do plano: o JSON do job (com o CTA) é apagado no done
      r.job_json = null;
      return { ...r };
    }, true);
  }

  release(id: string, code: ErrorCode, cost?: JobCost) {
    return this.exclusive((jobs) => {
      const r = jobs[id];
      if (!r || r.status === "done") return r ? { ...r } : null;
      Object.assign(r, { status: "failed", error_code: code, finished_at: new Date().toISOString(), job_json: null });
      if (cost) r.cost = cost;
      if (r.credit_state === "reserved") r.credit_state = "released";
      return { ...r };
    }, true);
  }

  requeue(id: string) {
    return this.exclusive((jobs) => {
      const r = jobs[id];
      if (r && r.status === "running") r.status = "queued";
    }, true);
  }
}
