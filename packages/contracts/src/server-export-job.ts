import { z } from "zod";
import { exportJobSchema, type ExportJob } from "./export-job";

/**
 * ExportJob aceito pelo SERVIDOR de exportação (Etapa 4). O job vem do cliente e não é confiável:
 * além do schema geral, aqui ficam o escopo da v1 e os limites de custo. O que depende do arquivo
 * real (duração medida, canais, fingerprint) é conferido de novo no serviço, depois de decodificar.
 *
 * Cada problema vira uma issue cuja mensagem é um CÓDIGO fechado (nunca o valor recebido).
 */
export const SERVER_LIMITS = {
  /** Decisão 7 da Etapa 4: começa com 10 min (2 GiB por instância). */
  maxDurationS: 600,
  maxChannels: 2,
  minSampleRate: 8000,
  maxSampleRate: 96000,
  /** 32 do editor + 9 do master. */
  maxChainModules: 41,
  maxAmps: 2,
  maxDrumStudios: 1,
  maxReverbs: 4,
  /** Cabe folgado nos 64 KB do JSON (~45 bytes por trecho). */
  maxSegments: 1000,
  /** Folga entre os trechos de corte e a duração declarada (s). */
  segmentSlackS: 0.05,
  /** Tamanho máximo do JSON do job (bytes, UTF-8). */
  maxJobBytes: 64 * 1024,
} as const;

export const SERVER_JOB_CODES = ["INVALID_JOB", "OUT_OF_SCOPE", "TOO_LONG", "TOO_LARGE", "LIMIT", "REF_INVALID"] as const;
export type ServerJobCode = (typeof SERVER_JOB_CODES)[number];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Mesmo formato aceito por spend_export_credit (p_ref). */
export const P_REF = /^[a-zA-Z0-9:_-]{8,128}$/;

function checks(j: ExportJob, ctx: z.RefinementCtx) {
  const issue = (code: ServerJobCode, path: (string | number)[]) => ctx.addIssue({ code: "custom", message: code, path });

  // ----- escopo da v1: só áudio processado (sem render, sem textos do usuário, sem música)
  if (j.output.render) issue("OUT_OF_SCOPE", ["output", "render"]);
  if (j.captions !== null) issue("OUT_OF_SCOPE", ["captions"]);
  if (j.look.cta !== null) issue("OUT_OF_SCOPE", ["look", "cta"]);
  if (j.look.audiogram !== null) issue("OUT_OF_SCOPE", ["look", "audiogram"]);
  if (j.audio.music !== null) issue("OUT_OF_SCOPE", ["audio", "music"]);
  if ((j.kind === "video") !== (j.output.target === "video")) issue("INVALID_JOB", ["kind"]);
  if (j.output.target === "video") {
    // vídeo só trocando o áudio: o servidor devolve o áudio e o aparelho junta com o vídeo
    if (j.source.media !== "video") issue("OUT_OF_SCOPE", ["source", "media"]);
    if (j.look.before_after) issue("OUT_OF_SCOPE", ["look", "before_after"]);
  }

  // ----- origem (o serviço confere de novo contra o arquivo decodificado)
  if (j.source.duration_s > SERVER_LIMITS.maxDurationS) issue("TOO_LONG", ["source", "duration_s"]);
  if (j.source.channels > SERVER_LIMITS.maxChannels) issue("INVALID_JOB", ["source", "channels"]);
  if (j.source.sample_rate < SERVER_LIMITS.minSampleRate || j.source.sample_rate > SERVER_LIMITS.maxSampleRate)
    issue("INVALID_JOB", ["source", "sample_rate"]);

  // ----- cadeia: limites de custo
  const chain = j.audio.chain.chain;
  if (chain.length > SERVER_LIMITS.maxChainModules) issue("LIMIT", ["audio", "chain", "chain"]);
  const count = (t: string) => chain.filter((m) => m.type === t).length;
  if (count("amp") > SERVER_LIMITS.maxAmps) issue("LIMIT", ["audio", "chain", "amp"]);
  if (count("drum_studio") > SERVER_LIMITS.maxDrumStudios) issue("LIMIT", ["audio", "chain", "drum_studio"]);
  if (count("reverb") > SERVER_LIMITS.maxReverbs) issue("LIMIT", ["audio", "chain", "reverb"]);

  // ----- ativos: só ids (o servidor resolve os arquivos pelo banco e ignora os caminhos do job)
  j.audio.assets.drum_samples.forEach((a, i) => {
    if (a.id !== "synth" && !UUID.test(a.id)) issue("INVALID_JOB", ["audio", "assets", "drum_samples", i, "id"]);
  });
  j.audio.assets.irs.forEach((a, i) => {
    if (!UUID.test(a.id) && !/^mp:[a-z0-9-]{1,40}$/.test(a.id)) issue("INVALID_JOB", ["audio", "assets", "irs", i, "id"]);
  });

  // ----- cortes: ordenados, sem sobreposição, dentro do áudio declarado
  const segs = j.cuts.segments;
  if (segs.length > SERVER_LIMITS.maxSegments) issue("LIMIT", ["cuts", "segments"]);
  if (j.cuts.applied && j.cuts.level === "off") issue("INVALID_JOB", ["cuts", "level"]);
  const lo = j.source.audio_start_s - SERVER_LIMITS.segmentSlackS;
  const hi = j.source.audio_start_s + j.source.duration_s + SERVER_LIMITS.segmentSlackS;
  segs.forEach((s, i) => {
    if (!(s.end > s.start) || s.start < lo || s.end > hi || (i > 0 && s.start < segs[i - 1].end))
      issue("INVALID_JOB", ["cuts", "segments", i]);
  });

  // ----- referências: formato do p_ref e encadeamento audio_ref → idempotency_ref → alvo
  if (!P_REF.test(j.idempotency_ref)) issue("REF_INVALID", ["idempotency_ref"]);
  if (!j.audio.audio_ref.startsWith(`${j.source.file_ref}_`)) issue("REF_INVALID", ["audio", "audio_ref"]);
  if (!j.idempotency_ref.startsWith(`${j.audio.audio_ref}_e`) || !j.idempotency_ref.endsWith(`_${j.output.target}`))
    issue("REF_INVALID", ["idempotency_ref"]);
}

export const serverExportJobSchema = exportJobSchema.superRefine(checks);
