/**
 * Jobs de ferramentas no Supabase: só as RPCs de supabase/migrations/20261010000001_tools_pro.sql,
 * com a chave service_role. Erros chegam com um código fechado (nunca o texto do banco).
 */
import { ERROR_CODES, type ErrorCode } from "../errors";
import { logDiag } from "../log";
import { RpcError } from "./supabase-jobs";

export type ToolRecord = {
  id: string;
  user_id: string;
  tool: string;
  status: "queued" | "running" | "done" | "failed" | "expired";
  params: Record<string, unknown>;
  inputs: string[];
  credits: number;
  credit_state: string;
  attempts: number;
  expires_at: string;
};

export type ToolOutput = { key: string; name: string; bytes: number };
export type ToolCost = { cpu_ms: number; rss_mb: number; wall_ms: number };

export interface ToolStore {
  start(id: string, staleMs: number): Promise<{ outcome: "started" | "busy" | "done" | "failed" | "missing"; record: ToolRecord | null }>;
  progress(id: string, pct: number): Promise<void>;
  commit(id: string, outputs: ToolOutput[], measures: Record<string, unknown>, cost: ToolCost): Promise<{ status: string; error_code?: ErrorCode }>;
  release(id: string, code: ErrorCode, cost?: ToolCost): Promise<void>;
  requeue(id: string): Promise<void>;
}

export class SupabaseToolStore implements ToolStore {
  constructor(
    private url: string,
    private key: string,
  ) {}

  private async rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
    let res: Response;
    try {
      res = await fetch(`${this.url.replace(/\/$/, "")}/rest/v1/rpc/${fn}`, {
        method: "POST",
        headers: { apikey: this.key, Authorization: `Bearer ${this.key}`, "Content-Type": "application/json" },
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
      const code = (ERROR_CODES as readonly string[]).includes(message) ? (message as ErrorCode) : "INTERNAL";
      if (code === "INTERNAL") logDiag("banco_falhou", { funcao: fn, http: res.status });
      throw new RpcError(code);
    }
    return (text ? JSON.parse(text) : null) as T;
  }

  async start(id: string, staleMs: number) {
    const r = await this.rpc<{ outcome: "started" | "busy" | "done" | "failed" | "missing"; job?: ToolRecord }>("start_tool_job", { p_job_id: id, p_stale_seconds: Math.round(staleMs / 1000) });
    return { outcome: r.outcome, record: r.job ?? null };
  }
  async progress(id: string, pct: number) {
    await this.rpc("report_tool_progress", { p_job_id: id, p_pct: Math.round(pct) });
  }
  commit(id: string, outputs: ToolOutput[], measures: Record<string, unknown>, cost: ToolCost) {
    return this.rpc<{ status: string; error_code?: ErrorCode }>("commit_tool_job", { p_job_id: id, p_outputs: outputs, p_measures: measures, p_cost: cost });
  }
  async release(id: string, code: ErrorCode, cost?: ToolCost) {
    await this.rpc("release_tool_job", { p_job_id: id, p_code: code, p_cost: cost ?? null });
  }
  async requeue(id: string) {
    await this.rpc("requeue_tool_job", { p_job_id: id });
  }
}

/** Em memória (testes do serviço sem banco). */
export class MemoryToolStore implements ToolStore {
  jobs = new Map<string, ToolRecord & { outputs?: ToolOutput[]; measures?: Record<string, unknown>; error_code?: string | null; progress?: number }>();
  async start(id: string) {
    const j = this.jobs.get(id);
    if (!j) return { outcome: "missing" as const, record: null };
    if (j.status === "done") return { outcome: "done" as const, record: j };
    if (j.status === "failed") return { outcome: "failed" as const, record: j };
    j.status = "running";
    j.attempts++;
    return { outcome: "started" as const, record: j };
  }
  async progress(id: string, pct: number) {
    const j = this.jobs.get(id);
    if (j) j.progress = Math.max(j.progress ?? 0, pct);
  }
  async commit(id: string, outputs: ToolOutput[], measures: Record<string, unknown>) {
    const j = this.jobs.get(id)!;
    Object.assign(j, { status: "done", outputs, measures, credit_state: j.credits > 0 ? "charged" : j.credit_state });
    return { status: "done" };
  }
  async release(id: string, code: ErrorCode) {
    const j = this.jobs.get(id);
    if (j && j.status !== "done") Object.assign(j, { status: "failed", error_code: code, credit_state: j.credit_state === "reserved" ? "released" : j.credit_state });
  }
  async requeue(id: string) {
    const j = this.jobs.get(id);
    if (j?.status === "running") j.status = "queued";
  }
}
