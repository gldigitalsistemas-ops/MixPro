/**
 * Execução de um job de exportação de ÁUDIO no servidor (Etapa 4, fatia 3).
 *
 * Ordem: job lido do adaptador (nunca do corpo da requisição) → schema estrito + p_ref recalculado
 * → tamanho da entrada → ffprobe + limites + decodificação em fluxo (stdin do FFmpeg, sem disco)
 * → conferência contra job.source → samples/IRs resolvidos SÓ por ID no catálogo → processAudio +
 * cortes (o mesmo código do app) → WAV (exportAudio, mesmo dither) ou MP3/M4A (FFmpeg) → saída no
 * armazenamento → commit com medidas e custo.
 */
import { createHash } from "node:crypto";
import type { ExportJob } from "@mixpro/contracts";
import { CABS, isBuiltinCab } from "@/lib/dsp/cab-ir";
import { integratedLoudness, samplePeak } from "@/lib/dsp/loudness";
import type { Signal } from "@/lib/dsp/types";
import { DSP_VERSION } from "@/lib/dsp/version";
import { SLOT_PARAM } from "@/lib/drums/tweaks";
import { processJobAudio } from "@/lib/export/audio-job";
import { decodeMedia, DecodeError, type DecodedMedia } from "@/lib/export/ffmpeg-decode";
import { encodeWithFfmpeg, EncodeError } from "@/lib/export/ffmpeg-encode";
import { loadJobAssets } from "@/lib/export/node-assets";
import { validateServerJob } from "@/lib/export/server-validate";
import { signalFingerprint } from "@/lib/hash";
import { exportAudio } from "@/lib/media/export";
import type { LoadedMedia } from "@/lib/media/load";
import type { AssetCatalog } from "./adapters/catalog";
import type { JobCost, JobObserved, JobStore } from "./adapters/jobs";
import type { Storage } from "./adapters/storage";
import { fromDecode, JobError, RETRYABLE, type ErrorCode } from "./errors";
import { logJob } from "./log";

export type ServiceDeps = {
  storage: Storage;
  jobs: JobStore;
  catalog: AssetCatalog;
  ffmpeg: string;
  ffprobe: string;
  /** URL pública do projeto Supabase (bucket público drum-samples). */
  assetStorageUrl: string;
  /** Cache de samples/IRs em memória (um por instância). */
  assetMemory: Map<string, Uint8Array>;
  limits: ServiceLimits;
};

export type ServiceLimits = {
  maxInputBytes: number;
  maxDurationS: number;
  /** Um job "running" mais velho que isso pode ser retomado. */
  staleMs: number;
  maxAttempts: number;
  /** Limite de cada processo do FFmpeg (s). */
  processTimeoutS: number;
  maxAssetBytes: number;
};

export const DEFAULT_LIMITS: ServiceLimits = {
  // WAV de 10 min (o limite de duração) em 48 kHz/24 bits estéreo ≈ 173 MB; a decodificação é em fluxo
  maxInputBytes: 200 * 1024 * 1024,
  maxDurationS: 600,
  staleMs: 15 * 60_000,
  maxAttempts: 3,
  processTimeoutS: 300,
  maxAssetBytes: 2 * 1024 * 1024,
};

/** Contêineres e codecs que o app sabe abrir (lib/media/load.ts) e o servidor aceita. */
export const ALLOWED = {
  containers: /^(mov,mp4,m4a,3gp,3g2,mj2|mp3|wav|ogg|matroska,webm|flac)$/,
  codecs: /^(aac|mp3|pcm_(s16le|s24le|s32le|f32le|u8)|opus|vorbis|flac)$/,
};

export type RunResult = { http: 200 | 404 | 409 | 503; status: "done" | "failed" | "busy" | "retry" | "missing"; error_code?: ErrorCode };

const sha32 = (x: Signal) => {
  const h = createHash("sha256");
  for (const c of x) h.update(Buffer.from(c.buffer, c.byteOffset, c.byteLength));
  return h.digest("hex");
};

/** Assets do job resolvidos pelo catálogo, a partir dos IDs da CADEIA (os caminhos do job são ignorados). */
async function resolveAssets(job: ExportJob, catalog: AssetCatalog): Promise<ExportJob> {
  const chain = job.audio.chain.chain;
  const drumIds = new Set<string>();
  const drum = chain.find((m) => m.type === "drum_studio");
  for (const key of Object.values(SLOT_PARAM)) {
    const id = (drum?.params as Record<string, unknown> | undefined)?.[key];
    if (typeof id === "string" && id && id !== "synth") drumIds.add(id);
  }
  const irIds = new Set<string>();
  for (const m of chain.filter((m) => m.type === "amp" && !m.bypass)) {
    const id = (m.params as Record<string, unknown>).ir;
    if (typeof id === "string" && id) irIds.add(id);
  }
  const drum_samples = [];
  for (const id of drumIds) {
    const a = await catalog.drumSample(id).catch(() => {
      throw new JobError("ASSET_FAILED");
    });
    if (!a) throw new JobError("ASSET_NOT_FOUND");
    drum_samples.push({ id, builtin: false, files: a.files, room_files: a.room_files ?? [] });
  }
  const irs = [];
  for (const id of irIds) {
    if (isBuiltinCab(id)) {
      if (!CABS.some((c) => c.id === id)) throw new JobError("ASSET_NOT_FOUND");
      irs.push({ id, builtin: true, file: null });
      continue;
    }
    const a = await catalog.ir(id).catch(() => {
      throw new JobError("ASSET_FAILED");
    });
    if (!a) throw new JobError("ASSET_NOT_FOUND");
    irs.push({ id, builtin: false, file: a.file });
  }
  return { ...job, audio: { ...job.audio, assets: { drum_samples, irs } } };
}

/** O áudio medido no servidor confere com o que o job declarou? */
function checkSource(job: ExportJob, d: DecodedMedia) {
  if (d.sampleRate !== job.source.sample_rate) throw new JobError("RATE_MISMATCH");
  if (d.channels.length !== job.source.channels) throw new JobError("CHANNELS_MISMATCH");
  if (Math.abs(d.duration - job.source.duration_s) > 0.1) throw new JobError("DURATION_MISMATCH");
  if (Math.abs(d.audioStart - job.source.audio_start_s) > 1 / d.sampleRate) throw new JobError("START_MISMATCH");
}

export async function runJob(jobId: string, deps: ServiceDeps): Promise<RunResult> {
  const t0 = performance.now();
  const cpu0 = process.cpuUsage();
  const etapas: Record<string, number> = {};
  let last = t0;
  const mark = (k: string) => {
    const now = performance.now();
    etapas[k] = Math.round(now - last);
    last = now;
  };
  // pico de memória DURANTE este job (o maxRSS do processo é da vida inteira da instância)
  let peak = process.memoryUsage().rss;
  const sampler = setInterval(() => (peak = Math.max(peak, process.memoryUsage().rss)), 50);
  const cost = (): JobCost => ({
    cpu_ms: Math.round((process.cpuUsage(cpu0).user + process.cpuUsage(cpu0).system) / 1000),
    rss_mb: Math.round(Math.max(peak, process.memoryUsage().rss) / 1048576),
    wall_ms: Math.round(performance.now() - t0),
    etapas_ms: etapas,
  });
  const base = { duracao_s: null as number | null, canais: null as number | null, taxa: null as number | null, alvo: null as string | null };
  // medido na entrada (vai para a telemetria de divergência, inclusive quando o job é recusado)
  let observed: JobObserved | undefined;
  let outputKey: string | null = null;

  try {
    const st = await deps.jobs.start(jobId, deps.limits.staleMs);
    if (st.outcome !== "started") {
      const c = cost();
      logJob({ job_id: jobId, status: "skipped", error_code: st.record?.error_code ?? null, ...base, ...c, dsp_version: DSP_VERSION });
      if (st.outcome === "missing") return { http: 404, status: "missing", error_code: "JOB_NOT_FOUND" };
      if (st.outcome === "busy") return { http: 409, status: "busy" };
      if (st.outcome === "done") return { http: 200, status: "done" };
      return { http: 200, status: "failed", error_code: st.record?.error_code ?? undefined };
    }
    const rec = st.record;

    try {
      // 1. o job do banco, revalidado (nunca o corpo da requisição)
      const v = validateServerJob(rec.job_json ?? "");
      if (!v.ok) throw new JobError(v.code);
      const job = v.job;
      base.alvo = job.output.target;
      mark("validar");

      // 2. entrada: tamanho, cabeçalho, limites e decodificação em fluxo
      const head = await deps.storage.head(rec.input_key).catch(() => {
        throw new JobError("STORAGE_FAILED");
      });
      if (!head) throw new JobError("INPUT_MISSING");
      if (head.size > deps.limits.maxInputBytes) throw new JobError("TOO_LARGE");
      let decoded: DecodedMedia | null = await decodeMedia(
        { open: () => deps.storage.read(rec.input_key) },
        { ffmpeg: deps.ffmpeg, ffprobe: deps.ffprobe, maxDurationS: deps.limits.maxDurationS, timeoutS: deps.limits.processTimeoutS, allow: ALLOWED },
      ).catch((e) => {
        throw e instanceof DecodeError ? new JobError(fromDecode(e.code)) : new JobError("INTERNAL");
      });
      Object.assign(base, { duracao_s: Number(decoded.duration.toFixed(3)), canais: decoded.channels.length, taxa: decoded.sampleRate });
      observed = {
        input_duration_s: decoded.duration,
        input_samples: decoded.channels[0].length,
        input_audio_start_s: decoded.audioStart,
        input_sample_rate: decoded.sampleRate,
      };
      checkSource(job, decoded);
      const fingerprint = signalFingerprint(decoded.channels);
      const inputSha = sha32(decoded.channels);
      const sr = decoded.sampleRate;
      mark("decodificar");
      await deps.jobs.reportProgress(rec.id, 10);

      // 3. samples e IRs, só por ID
      const resolved = await resolveAssets(job, deps.catalog);
      const assets = await loadJobAssets(resolved, sr, { storageUrl: deps.assetStorageUrl, memory: deps.assetMemory, maxBytes: deps.limits.maxAssetBytes }).catch(() => {
        throw new JobError("ASSET_FAILED");
      });
      mark("assets");

      // 4. o mesmo DSP do app (+ cortes)
      let lastPct = 10;
      const input = decoded.channels;
      decoded = null; // a entrada só vive dentro do processamento daqui em diante
      const out = await processJobAudio(job, input, sr, { drumSamples: assets.drumSamples, impulses: assets.impulses }, (p) => {
        const pct = 10 + Math.floor(p * 8) * 10;
        if (pct > lastPct) {
          lastPct = pct;
          void deps.jobs.reportProgress(rec.id, pct).catch(() => {});
        }
      });
      mark("dsp");

      // 5. medidas do áudio final (antes da gravação: o dither do WAV é aleatório)
      const measures = {
        duration_s: out[0].length / sr,
        samples: out[0].length,
        channels: out.length,
        sample_rate: sr,
        lufs: integratedLoudness(out, sr),
        peak: samplePeak(out),
        sha256_f32: sha32(out),
        content_fingerprint: fingerprint,
        input_sha256_f32: inputSha,
        output_bytes: 0,
        ...observed,
      };

      // 6. gravação: WAV pelo código do app; MP3/M4A pelo FFmpeg; vídeo → só o áudio em AAC (o aparelho junta)
      const target = job.output.target;
      const ext = target === "wav" ? "wav" : target === "mp3" ? "mp3" : "m4a";
      let bytes: Uint8Array;
      try {
        if (ext === "wav") {
          const media = { file: new File([], "audio.wav"), sampleRate: sr } as unknown as LoadedMedia;
          bytes = new Uint8Array(await (await exportAudio(media, out, "wav", () => {})).blob.arrayBuffer());
        } else bytes = await encodeWithFfmpeg(deps.ffmpeg, out, sr, ext, deps.limits.processTimeoutS);
      } catch (e) {
        throw new JobError(e instanceof EncodeError && e.code === "timeout" ? "TIMEOUT" : "ENCODE_FAILED");
      }
      measures.output_bytes = bytes.byteLength;
      mark("gravar");

      // 7. saída com chave fixa por job: repetir o job sobrescreve, não duplica
      outputKey = `out/${rec.id}.${ext}`;
      await deps.storage.put(outputKey, bytes).catch(() => {
        throw new JobError("STORAGE_FAILED");
      });
      mark("armazenar");

      const c = cost();
      await deps.jobs.commit(rec.id, { output_key: outputKey, measures, cost: c });
      logJob({ job_id: rec.id, status: "done", error_code: null, ...base, ...c, dsp_version: DSP_VERSION });
      return { http: 200, status: "done" };
    } catch (e) {
      const code: ErrorCode = e instanceof JobError ? e.code : "INTERNAL";
      const c = cost();
      // o commit recusou a entrega (outro áudio com o mesmo p_ref, saldo acabou, job cancelado): a saída não fica
      if (outputKey && (code === "REF_MISMATCH" || code === "INSUFFICIENT_CREDITS" || code === "CANCELLED")) await deps.storage.delete(outputKey).catch(() => {});
      if (RETRYABLE.has(code) && rec.attempts < deps.limits.maxAttempts) {
        await deps.jobs.requeue(rec.id);
        logJob({ job_id: rec.id, status: "retry", error_code: code, ...base, ...c, dsp_version: DSP_VERSION });
        return { http: 503, status: "retry", error_code: code };
      }
      await deps.jobs.release(rec.id, code, c, observed);
      logJob({ job_id: rec.id, status: "failed", error_code: code, ...base, ...c, dsp_version: DSP_VERSION });
      return { http: 200, status: "failed", error_code: code };
    }
  } finally {
    clearInterval(sampler);
  }
}
