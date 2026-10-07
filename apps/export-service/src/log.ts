/**
 * ÚNICO ponto do serviço que escreve no stdout. Uma linha JSON por job, só com campos desta lista:
 * nunca conteúdo do job, CTA, nome de arquivo, slug, ref, chave de armazenamento ou URL.
 * (Teste: apps/web/lib/export/privacy.test.ts verifica o serviço inteiro.)
 */
import type { ErrorCode } from "./errors";

export type JobLog = {
  job_id: string;
  status: "done" | "failed" | "retry" | "skipped";
  error_code: ErrorCode | null;
  duracao_s: number | null;
  canais: number | null;
  taxa: number | null;
  alvo: string | null;
  cpu_ms: number;
  rss_mb: number;
  wall_ms: number;
  etapas_ms: Record<string, number>;
  dsp_version: string;
};

const FIELDS: (keyof JobLog)[] = ["job_id", "status", "error_code", "duracao_s", "canais", "taxa", "alvo", "cpu_ms", "rss_mb", "wall_ms", "etapas_ms", "dsp_version"];
const ETAPAS = /^[a-z_]{1,24}$/;
const ALVOS = new Set(["wav", "mp3", "m4a", "video"]);

/** Monta a linha só com os campos permitidos (mesmo que o chamador passe algo a mais). */
export function jobLogLine(entry: JobLog): string {
  const out: Record<string, unknown> = {};
  for (const k of FIELDS) out[k] = entry[k];
  out.etapas_ms = Object.fromEntries(Object.entries(entry.etapas_ms ?? {}).filter(([k, v]) => ETAPAS.test(k) && typeof v === "number"));
  if (out.alvo !== null && !ALVOS.has(String(out.alvo))) out.alvo = null;
  if (!/^[0-9a-f-]{36}$/.test(String(out.job_id))) out.job_id = "invalido";
  return JSON.stringify({ evento: "export_job", ...out });
}

export function logJob(entry: JobLog) {
  process.stdout.write(jobLogLine(entry) + "\n");
}

/** Linhas operacionais fixas (início do serviço), sem dados de usuário. */
export function logService(evento: "inicio" | "parada", info: { porta?: number; dsp_version: string }) {
  process.stdout.write(JSON.stringify({ evento: `servico_${evento}`, porta: info.porta ?? null, dsp_version: info.dsp_version }) + "\n");
}
