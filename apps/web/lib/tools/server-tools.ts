/**
 * Regras das rotas /api/tools/jobs (Vercel), separadas dos handlers para teste com dependências falsas.
 * Nunca confia no cliente: parâmetros validados pelo contrato, formatos e Cofre só no Plano Pro, preço
 * calculado aqui (a partir das durações declaradas, conferidas de novo no serviço), dono conferido em
 * toda operação. Envio direto ao R2 por URL assinada com o tamanho fixo.
 */
import { randomUUID } from "node:crypto";
import { parseToolParams, PRO_FORMATS, toolCredits, type ToolCosts, type ToolId } from "@mixpro/contracts";
import { exportErrorInfo } from "@/lib/export/error-messages";
import type { Deps as ExportDeps, Fail, Ok } from "@/lib/export/server-jobs";
import { MAX_INPUT_BYTES } from "@/lib/export/server-limits";

export type ToolDeps = ExportDeps & {
  costs(): Promise<ToolCosts>;
  isPro(userId: string): Promise<boolean>;
};

/** As ferramentas só rodam no servidor: a mensagem nunca sugere processar no aparelho. */
export function toolMessage(code: string): string {
  const i = exportErrorInfo(code);
  return i.device ? "Não conseguimos processar agora. Tente de novo em alguns minutos; nenhum crédito foi usado." : i.message;
}

const fail = (code: string): Fail => ({ ok: false, status: exportErrorInfo(code).status, code, message: toolMessage(code), device: false });

function rpcCode(error: { message: string }): string {
  const m = error.message.match(/\b(INSUFFICIENT_CREDITS|RATE_LIMITED|CAPACITY|INVALID_JOB|NEEDS_PURCHASE|JOB_NOT_FOUND)\b/);
  return m ? m[1] : "INTERNAL";
}

type ToolRow = { id: string; user_id: string; tool: ToolId; status: string; progress: number; inputs: string[]; outputs: { key: string; name: string; bytes: number }[] | null; error_code: string | null; credits: number; credit_state: string; measures: Record<string, unknown> | null; expires_at: string };

async function loadOwned(d: ToolDeps, userId: string, id: string): Promise<ToolRow | Fail> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return fail("JOB_NOT_FOUND");
  const { data, error } = await d.rpc("get_tool_job", { p_job_id: id });
  const row = data as ToolRow | null;
  if (error || !row || row.user_id !== userId) return fail("JOB_NOT_FOUND");
  return row;
}

export const UPLOAD_TTL_S = 900;
export const DOWNLOAD_TTL_S = 300;

export async function createTool(
  d: ToolDeps,
  userId: string,
  req: { tool: string; params: unknown; inputBytes: number[] },
): Promise<Ok<{ jobId: string; credits: number; uploads: { url: string }[]; retentionDays: number }> | Fail> {
  const parsed = parseToolParams(req.tool, req.params);
  if (!parsed) return fail("INVALID_JOB");
  const { tool, params } = parsed;
  if (!Array.isArray(req.inputBytes) || req.inputBytes.length !== params.durations.length) return fail("INVALID_JOB");
  if (req.inputBytes.some((b) => !Number.isInteger(b) || b < 1 || b > MAX_INPUT_BYTES)) return fail("TOO_LARGE");
  const pro = await d.isPro(userId).catch(() => false);
  if (PRO_FORMATS.includes(params.format) && !pro) return fail("PRO_ONLY");
  const credits = toolCredits(tool, params, await d.costs());
  const retentionDays = pro ? 30 : 1;
  const keys = params.durations.map(() => `in/${randomUUID()}`);
  const { data, error } = await d.rpc("create_tool_job", {
    p_user: userId,
    p_tool: tool,
    p_params: params,
    p_inputs: keys,
    p_credits: credits,
    p_retention_days: retentionDays,
  });
  if (error) return fail(rpcCode(error));
  const r = data as { job_id: string };
  return {
    ok: true,
    jobId: r.job_id,
    credits,
    retentionDays,
    uploads: keys.map((k, i) => ({ url: d.objects.presign("PUT", k, UPLOAD_TTL_S, { contentLength: req.inputBytes[i] }) })),
  };
}

export async function startTool(d: ToolDeps, userId: string, id: string): Promise<Ok<{ status: string }> | Fail> {
  const row = await loadOwned(d, userId, id);
  if ("ok" in row) return row;
  if (row.status !== "queued") return { ok: true, status: row.status };
  for (const k of row.inputs) {
    const h = await d.objects.head(k);
    if (!h) return fail("INPUT_MISSING");
    if (h.size > MAX_INPUT_BYTES) return fail("TOO_LARGE");
  }
  const pro = await d.isPro(userId).catch(() => false);
  try {
    await d.queue.enqueue(id, { kind: "tool", heavy: row.tool === "stems", priority: pro });
  } catch {
    return fail("CAPACITY");
  }
  return { ok: true, status: "queued" };
}

export type ToolStatus = {
  status: string;
  progress: number;
  tool: ToolId;
  credits: number;
  errorCode: string | null;
  message: string | null;
  measures: Record<string, unknown> | null;
  outputs: { name: string; bytes: number; url: string }[];
  expiresAt: string;
};

export async function toolStatus(d: ToolDeps, userId: string, id: string): Promise<Ok<ToolStatus> | Fail> {
  const row = await loadOwned(d, userId, id);
  if ("ok" in row) return row;
  const alive = row.status === "done" && new Date(row.expires_at).getTime() > Date.now();
  return {
    ok: true,
    status: row.status,
    progress: row.progress,
    tool: row.tool,
    credits: row.credits,
    errorCode: row.error_code,
    message: row.error_code ? toolMessage(row.error_code) : null,
    measures: row.measures,
    expiresAt: row.expires_at,
    outputs: alive && row.outputs ? row.outputs.map((o) => ({ name: o.name, bytes: o.bytes, url: d.objects.presign("GET", o.key, DOWNLOAD_TTL_S, { downloadName: o.name.replace(/[^A-Za-z0-9._-]/g, "_") }) })) : [],
  };
}

export async function cancelTool(d: ToolDeps, userId: string, id: string): Promise<Ok<{ status: string }> | Fail> {
  const row = await loadOwned(d, userId, id);
  if ("ok" in row) return row;
  const { error } = await d.rpc("cancel_tool_job", { p_job_id: id, p_user: userId });
  if (error) return fail(rpcCode(error));
  for (const k of row.inputs) await d.objects.delete(k).catch(() => {});
  return { ok: true, status: "failed" };
}
