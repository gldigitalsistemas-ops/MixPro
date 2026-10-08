/**
 * Validação de um ExportJob recebido pelo SERVIDOR (rota da Vercel e serviço de exportação).
 * O job vem do cliente e não é confiável:
 *  1. tamanho do JSON;
 *  2. schema estrito (packages/contracts/server-export-job.ts): escopo da v1 e limites;
 *  3. mesma versão do DSP do servidor;
 *  4. o render é recalculado a partir do visual (não basta o campo output.render);
 *  5. o p_ref é RECALCULADO a partir do próprio job com o código do app (lib/export/refs.ts).
 *     Só a parte do arquivo (hash de nome|tamanho|data) é aceita como veio: o servidor não
 *     recebe nome nem data. Essa parte é ancorada depois ao áudio decodificado (Etapa 4, decisão 1).
 * O resultado nunca carrega valores recebidos, só códigos e caminhos de campos.
 */
import { SERVER_LIMITS, deliverySuffix, serverExportJobSchema, type ExportJob, type ServerJobCode } from "@mixpro/contracts";
import type { ChainDoc } from "@/lib/dsp/chain";
import { DSP_VERSION } from "@/lib/dsp/version";
import { fnvHex } from "@/lib/hash";
import { lookOf, rendersVideo } from "./look";
import { editRef, resultRef, settingsRef } from "./refs";

export type ServerJobResult =
  | { ok: true; job: ExportJob }
  | { ok: false; code: ServerJobCode | "VERSION_MISMATCH"; paths: string[] };

/** Ordem de prioridade quando há mais de um problema (o mais importante vira o código). */
const PRIORITY: (ServerJobCode | "VERSION_MISMATCH")[] = ["TOO_LARGE", "INVALID_JOB", "OUT_OF_SCOPE", "TOO_LONG", "LIMIT", "REF_INVALID"];

const fail = (code: ServerJobCode | "VERSION_MISMATCH", paths: string[]): ServerJobResult => ({ ok: false, code, paths });

/**
 * @param body o corpo recebido (texto JSON, como chegou na requisição)
 * @param dspVersion versão do DSP deste servidor (padrão: a do código)
 */
export function validateServerJob(body: string, dspVersion: string = DSP_VERSION): ServerJobResult {
  if (new TextEncoder().encode(body).length > SERVER_LIMITS.maxJobBytes) return fail("TOO_LARGE", ["(raiz)"]);
  let raw: unknown;
  try {
    raw = JSON.parse(body);
  } catch {
    return fail("INVALID_JOB", ["(raiz)"]);
  }

  const parsed = serverExportJobSchema.safeParse(raw);
  if (!parsed.success) {
    const byCode = new Map<string, string[]>();
    for (const i of parsed.error.issues) {
      const code = i.code === "custom" && PRIORITY.includes(i.message as ServerJobCode) ? i.message : "INVALID_JOB";
      byCode.set(code, [...(byCode.get(code) ?? []), i.path.join(".") || "(raiz)"]);
    }
    const code = PRIORITY.find((c) => byCode.has(c)) ?? "INVALID_JOB";
    return fail(code, [...new Set(byCode.get(code))]);
  }
  const job = parsed.data;

  if (job.engine.dsp_version !== dspVersion) return fail("VERSION_MISMATCH", ["engine.dsp_version"]);
  if (rendersVideo(job) && job.output.target === "video") return fail("OUT_OF_SCOPE", ["look"]);

  // p_ref recalculado. A cadeia usa o JSON BRUTO: o zod reordena as chaves e o hash depende da ordem.
  const rawChain = (raw as { audio: { chain: ChainDoc } }).audio.chain;
  const audio = `${job.source.file_ref}_${job.audio.preset.slug}_${job.audio.intensity}_${job.audio.social.enabled ? 1 : 0}${job.audio.social.enabled ? deliverySuffix(job.audio.social.target_lufs, job.audio.social.ceiling_db) : ""}_n${Math.round(job.audio.denoise * 100)}_x${fnvHex(JSON.stringify(rawChain))}`;
  if (audio !== job.audio.audio_ref) return fail("REF_INVALID", ["audio.audio_ref"]);
  const edit = editRef({
    cutting: job.cuts.applied,
    segments: job.cuts.segments,
    look: lookOf(job),
    audiogram: null,
    music: null,
    comparing: job.look.before_after,
  });
  if (resultRef(settingsRef(audio, edit), job.output.target) !== job.idempotency_ref) return fail("REF_INVALID", ["idempotency_ref"]);

  return { ok: true, job };
}
