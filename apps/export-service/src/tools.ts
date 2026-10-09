/**
 * Execução das ferramentas no servidor: Tom e andamento, Voz + Playback, Masterização por referência,
 * Modo álbum, Separação de faixas e Conversão de formato.
 *
 * Ordem: job do banco (nunca do corpo da requisição) → parâmetros revalidados → entradas baixadas para um
 * arquivo temporário (aceita MP4 com índice no fim, WMA, AIFF…) e decodificadas → duração conferida com a
 * declarada (o preço depende dela) → processamento → gravação → saída no armazenamento → commit (débito na
 * mesma transação que marca pronto). Cancelado ou sem saldo no commit: a saída é apagada.
 */
import { createWriteStream } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pipeline as pipe } from "node:stream/promises";
import { DELIVERY_TARGETS, parseToolParams, type DeliveryId, type ToolId } from "@mixpro/contracts";
import { limiter } from "@/lib/dsp/dynamics";
import { integratedLoudness, samplePeak } from "@/lib/dsp/loudness";
import type { Signal } from "@/lib/dsp/types";
import { DSP_VERSION } from "@/lib/dsp/version";
import { decodeMedia, DecodeError, type DecodedMedia } from "@/lib/export/ffmpeg-decode";
import { encodeWithFfmpeg, EncodeError, filterWithFfmpeg } from "@/lib/export/ffmpeg-encode";
import { detectBpm, detectKey, transposeKey } from "@/lib/tools/analysis";
import { albumMaster, alignOffset, mixVoicePlayback, referenceMaster, toRate } from "@/lib/tools/mixing";
import { zipStore } from "@/lib/tools/zip";
import type { Storage } from "./adapters/storage";
import type { ToolOutput, ToolRecord, ToolStore } from "./adapters/tool-store";
import { fromDecode, JobError, RETRYABLE, type ErrorCode } from "./errors";
import { logJob } from "./log";
import { separateStems, StemsUnavailable } from "./stems";

export type ToolDeps = {
  storage: Storage;
  tools: ToolStore;
  ffmpeg: string;
  ffprobe: string;
  limits: { maxInputBytes: number; staleMs: number; maxAttempts: number; processTimeoutS: number };
};

/** Mais formatos que a exportação: as ferramentas recebem o arquivo como o usuário tem (WMA, AIFF, ALAC…). */
export const TOOL_ALLOWED = {
  containers: /^(mov,mp4,m4a,3gp,3g2,mj2|mp3|wav|w64|ogg|matroska,webm|flac|asf|aiff|caf|aac)$/,
  codecs: /^(aac|mp3|alac|opus|vorbis|flac|wmav1|wmav2|wmapro|pcm_(s16le|s24le|s32le|f32le|u8|s16be|s24be|s32be|f32be))$/,
};

export type ToolRunResult = { http: 200 | 404 | 409 | 503; status: "done" | "failed" | "busy" | "retry" | "missing"; error_code?: ErrorCode };

const EXT: Record<string, string> = { wav: "wav", wav24: "wav", mp3: "mp3", m4a: "m4a", flac: "flac" };

/** Baixa a entrada para um arquivo temporário e decodifica (sem limite de layout do contêiner). */
async function fetchAndDecode(key: string, deps: ToolDeps, dir: string, maxS: number): Promise<DecodedMedia> {
  const head = await deps.storage.head(key).catch(() => {
    throw new JobError("STORAGE_FAILED");
  });
  if (!head) throw new JobError("INPUT_MISSING");
  if (head.size > deps.limits.maxInputBytes) throw new JobError("TOO_LARGE");
  const file = join(dir, key.replace(/\W/g, "_"));
  await pipe(deps.storage.read(key), createWriteStream(file)).catch(() => {
    throw new JobError("STORAGE_FAILED");
  });
  try {
    return await decodeMedia(file, { ffmpeg: deps.ffmpeg, ffprobe: deps.ffprobe, maxDurationS: maxS, timeoutS: deps.limits.processTimeoutS, allow: TOOL_ALLOWED });
  } catch (e) {
    throw e instanceof DecodeError ? new JobError(fromDecode(e.code)) : new JobError("INTERNAL");
  } finally {
    await rm(file, { force: true });
  }
}

/** Teto de pico de segurança depois de mudar tom/andamento (o processamento muda os picos). */
function safety(x: Signal, sr: number): Signal {
  return samplePeak(x) > 10 ** (-1 / 20) ? limiter(x, sr, { ceiling_db: -1, input_gain_db: 0, release_ms: 60, lookahead_ms: 5 }) : x;
}

type Produced = { name: string; channels: Signal; sampleRate: number }[];

async function runToolAudio(tool: ToolId, p: Record<string, unknown>, media: DecodedMedia[], deps: ToolDeps, onProgress: (v: number) => void): Promise<{ files: Produced; measures: Record<string, unknown>; zip?: string }> {
  const fmt = p.format as string;
  const delivery = (id: unknown) => DELIVERY_TARGETS[(id as DeliveryId) ?? "social"] ?? DELIVERY_TARGETS.social;
  switch (tool) {
    case "pitch_tempo": {
      const m = media[0];
      const st = p.semitones as number;
      const tempo = p.tempo as number;
      const key = detectKey(m.channels, m.sampleRate);
      const bpm = detectBpm(m.channels, m.sampleRate);
      onProgress(0.2);
      // rubberband: alta qualidade, preservando formantes (voz soa natural ao mudar o tom)
      const filter = `rubberband=pitch=${(2 ** (st / 12)).toFixed(6)}:tempo=${tempo.toFixed(4)}:pitchq=quality:formant=preserved`;
      const out = safety(await filterWithFfmpeg(deps.ffmpeg, m.channels, m.sampleRate, filter, deps.limits.processTimeoutS), m.sampleRate);
      const tag = `${st > 0 ? "+" : ""}${st}st_${Math.round(tempo * 100)}pct`;
      return {
        files: [{ name: `tom-e-andamento_${tag}.${EXT[fmt]}`, channels: out, sampleRate: m.sampleRate }],
        measures: {
          tom_antes: key?.label ?? null,
          tom_depois: key ? transposeKey(key, st).label : null,
          bpm_antes: bpm?.bpm ?? null,
          bpm_depois: bpm ? Math.round(bpm.bpm * tempo * 10) / 10 : null,
        },
      };
    }
    case "voice_playback": {
      const [voice, pb] = media;
      const sr = pb.sampleRate;
      const v = toRate(voice.channels, voice.sampleRate, sr);
      const auto = p.offset_s === null ? alignOffset(v, pb.channels, sr) : null;
      const d = delivery(p.delivery);
      onProgress(0.3);
      const { out, report } = mixVoicePlayback(v, pb.channels, sr, {
        offsetS: (p.offset_s as number | null) ?? auto?.offsetS ?? 0,
        voiceLevelDb: p.voice_level_db as number,
        reverb: p.reverb as number,
        targetLufs: d.targetLufs,
        ceilingDb: d.ceilingDb,
      });
      return { files: [{ name: `voz-e-playback.${EXT[fmt]}`, channels: out, sampleRate: sr }], measures: { ...report, alinhamento_auto: auto ? auto.confidence : null } };
    }
    case "reference_master": {
      const [track, ref] = media;
      const r = toRate(ref.channels, ref.sampleRate, track.sampleRate);
      onProgress(0.3);
      const { out, report } = referenceMaster(track.channels, r, track.sampleRate, { amount: p.amount as number, ceilingDb: -1 });
      return { files: [{ name: `master-por-referencia.${EXT[fmt]}`, channels: out, sampleRate: track.sampleRate }], measures: report };
    }
    case "album": {
      const d = delivery(p.delivery);
      const res = albumMaster(
        media.map((m) => ({ channels: m.channels, sampleRate: m.sampleRate })),
        { amount: p.amount as number, targetLufs: d.targetLufs, ceilingDb: d.ceilingDb },
      );
      return {
        files: res.map((r, i) => ({ name: `faixa-${String(i + 1).padStart(2, "0")}.${EXT[fmt]}`, channels: r.out, sampleRate: media[i].sampleRate })),
        measures: { faixas_lufs: res.map((r) => Math.round(r.lufs * 10) / 10) },
        zip: "album-masterizado.zip",
      };
    }
    case "stems": {
      const m = media[0];
      let stems;
      try {
        stems = await separateStems(m.channels, m.sampleRate, (v) => onProgress(0.1 + v * 0.8));
      } catch (e) {
        if (e instanceof StemsUnavailable) throw new JobError("TOOL_UNAVAILABLE");
        throw e;
      }
      const names: Record<string, string> = { vocals: "voz", drums: "bateria", bass: "baixo", other: "instrumentos" };
      return {
        files: (["vocals", "drums", "bass", "other"] as const).map((s) => ({ name: `${names[s]}.${EXT[fmt]}`, channels: stems[s], sampleRate: m.sampleRate })),
        measures: { faixas: 4 },
        zip: "faixas-separadas.zip",
      };
    }
    case "convert": {
      const m = media[0];
      return { files: [{ name: `convertido.${fmt}`, channels: m.channels, sampleRate: m.sampleRate }], measures: { duracao_s: m.duration } };
    }
  }
}

export async function runTool(jobId: string, deps: ToolDeps): Promise<ToolRunResult> {
  const t0 = performance.now();
  const cpu0 = process.cpuUsage();
  let peak = process.memoryUsage().rss;
  const sampler = setInterval(() => (peak = Math.max(peak, process.memoryUsage().rss)), 100);
  const cost = () => ({
    cpu_ms: Math.round((process.cpuUsage(cpu0).user + process.cpuUsage(cpu0).system) / 1000),
    rss_mb: Math.round(peak / 1048576),
    wall_ms: Math.round(performance.now() - t0),
  });
  const log = (status: "done" | "failed" | "retry" | "skipped", code: ErrorCode | null) =>
    logJob({ job_id: jobId, status, error_code: code, duracao_s: null, canais: null, taxa: null, alvo: null, ...cost(), etapas_ms: {}, dsp_version: DSP_VERSION });
  const written: string[] = [];
  let dir = "";
  let rec: ToolRecord | null = null;
  try {
    const st = await deps.tools.start(jobId, deps.limits.staleMs);
    if (st.outcome !== "started") {
      log("skipped", null);
      if (st.outcome === "missing") return { http: 404, status: "missing", error_code: "JOB_NOT_FOUND" };
      if (st.outcome === "busy") return { http: 409, status: "busy" };
      return { http: 200, status: st.outcome === "done" ? "done" : "failed" };
    }
    rec = st.record!;
    const parsed = parseToolParams(rec.tool, rec.params);
    if (!parsed || parsed.params.durations.length !== rec.inputs.length) throw new JobError("INVALID_JOB");
    const { tool, params } = parsed;
    const report = (v: number) => void deps.tools.progress(jobId, Math.round(v * 100)).catch(() => {});

    dir = await mkdtemp(join(tmpdir(), "mixpro-tool-"));
    const media: DecodedMedia[] = [];
    for (let i = 0; i < rec.inputs.length; i++) {
      const m = await fetchAndDecode(rec.inputs[i], deps, dir, 600);
      // o preço depende da duração declarada: o arquivo não pode ser mais longo que ela
      if (m.duration > params.durations[i] + 2) throw new JobError("DURATION_MISMATCH");
      media.push(m);
      report(0.15 * ((i + 1) / rec.inputs.length));
    }

    const result = await runToolAudio(tool, params, media, deps, (v) => report(0.15 + v * 0.7));
    media.length = 0;

    // gravação: Cofre (Plano Pro, 30 dias) ou saída comum (24 h)
    const prefix = new Date(rec.expires_at).getTime() - Date.now() > 2 * 86_400_000 ? "cofre" : "out";
    const outputs: ToolOutput[] = [];
    const zipFiles: { name: string; data: Uint8Array }[] = [];
    for (let i = 0; i < result.files.length; i++) {
      const f = result.files[i];
      let bytes: Uint8Array;
      try {
        bytes = await encodeWithFfmpeg(deps.ffmpeg, f.channels, f.sampleRate, params.format as "wav" | "wav24" | "mp3" | "m4a" | "flac", deps.limits.processTimeoutS);
      } catch (e) {
        throw new JobError(e instanceof EncodeError && e.code === "timeout" ? "TIMEOUT" : "ENCODE_FAILED");
      }
      const key = `${prefix}/${jobId}/${i}.${EXT[params.format] ?? "wav"}`;
      await deps.storage.put(key, bytes).catch(() => {
        throw new JobError("STORAGE_FAILED");
      });
      written.push(key);
      outputs.push({ key, name: f.name, bytes: bytes.byteLength });
      if (result.zip) zipFiles.push({ name: f.name, data: bytes });
      report(0.85 + 0.1 * ((i + 1) / result.files.length));
    }
    if (result.zip && zipFiles.length > 1) {
      const key = `${prefix}/${jobId}/${result.files.length}.zip`;
      const zip = zipStore(zipFiles);
      await deps.storage.put(key, zip).catch(() => {
        throw new JobError("STORAGE_FAILED");
      });
      written.push(key);
      outputs.push({ key, name: result.zip, bytes: zip.byteLength });
    }

    const c = await deps.tools.commit(jobId, outputs, { ...result.measures, lufs: result.files[0] ? integratedLoudness(result.files[0].channels, result.files[0].sampleRate) : null }, cost());
    if (c.status !== "done") throw new JobError(c.error_code ?? "INTERNAL");
    log("done", null);
    return { http: 200, status: "done" };
  } catch (e) {
    const code: ErrorCode = e instanceof JobError ? e.code : "INTERNAL";
    // o commit recusou (cancelado, sem saldo) ou falhou no meio: nada parcial fica guardado
    for (const k of written) await deps.storage.delete(k).catch(() => {});
    if (rec && RETRYABLE.has(code) && rec.attempts < deps.limits.maxAttempts) {
      await deps.tools.requeue(jobId).catch(() => {});
      log("retry", code);
      return { http: 503, status: "retry", error_code: code };
    }
    if (rec) await deps.tools.release(jobId, code, cost()).catch(() => {});
    log("failed", code);
    return { http: 200, status: "failed", error_code: code };
  } finally {
    clearInterval(sampler);
    if (dir) await rm(dir, { recursive: true, force: true });
  }
}
