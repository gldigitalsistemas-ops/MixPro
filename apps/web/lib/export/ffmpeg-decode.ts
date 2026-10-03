/**
 * Decodificação da mídia do usuário NO SERVIDOR (FFmpeg nativo), com as mesmas regras do app
 * (lib/media/load.ts):
 *  - taxa ORIGINAL do arquivo (sem reamostrar);
 *  - pré-enchimento do AAC descartado (o FFmpeg aplica a edit list e o skip_samples do arquivo),
 *    audioStart = max(0, primeiro instante do áudio);
 *  - no máximo 2 canais; estéreo com os dois canais idênticos vira mono;
 *  - áudio com menos de 0,5 s é recusado (no_audio);
 *  - duração acima do limite é recusada pelo CABEÇALHO, antes de decodificar.
 * Só em Node. Os códigos de erro são os do app (MediaLoadError), sem texto do arquivo.
 */
import { spawn } from "node:child_process";
import type { Signal } from "@/lib/dsp/types";

export type DecodeErrorCode = "no_audio" | "unsupported" | "too_long" | "decode";

export class DecodeError extends Error {
  constructor(public code: DecodeErrorCode) {
    super(code);
    this.name = "DecodeError";
  }
}

export type DecodedMedia = {
  kind: "video" | "audio";
  sampleRate: number;
  channels: Signal;
  audioStart: number;
  duration: number;
  /** Informativo (nunca vai para logs com o nome do arquivo). */
  codec: string;
  container: string;
};

export type DecodeOptions = {
  ffmpeg?: string;
  ffprobe?: string;
  maxDurationS: number;
  /** Encerra o FFmpeg se passar disso (s). */
  timeoutS?: number;
};

type Probe = {
  streams?: { index: number; codec_type: string; codec_name?: string; sample_rate?: string; channels?: number; start_time?: string; duration?: string; disposition?: { attached_pic?: number } }[];
  format?: { format_name?: string; duration?: string };
};

function run(cmd: string, args: string[], timeoutS: number): Promise<{ code: number | null; stdout: Buffer }> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ["ignore", "pipe", "ignore"] });
    const chunks: Buffer[] = [];
    const timer = setTimeout(() => p.kill("SIGKILL"), timeoutS * 1000);
    p.stdout.on("data", (c: Buffer) => chunks.push(c));
    p.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    p.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout: Buffer.concat(chunks) });
    });
  });
}

/** Mesmo teste do app: o segundo canal só existe se for diferente do primeiro. */
function sameSamples(a: Float32Array, b: Float32Array): boolean {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

export async function decodeMedia(path: string, o: DecodeOptions): Promise<DecodedMedia> {
  const ffmpeg = o.ffmpeg ?? "ffmpeg";
  const ffprobe = o.ffprobe ?? "ffprobe";
  const timeoutS = o.timeoutS ?? 300;
  // entrada sempre arquivo local; nada de protocolos de rede, listas ou concatenação
  const safe = ["-protocol_whitelist", "file"];

  const probe = await run(ffprobe, ["-v", "error", ...safe, "-show_streams", "-show_format", "-of", "json", path], 60);
  if (probe.code !== 0) throw new DecodeError("unsupported");
  let info: Probe;
  try {
    info = JSON.parse(probe.stdout.toString("utf8"));
  } catch {
    throw new DecodeError("unsupported");
  }
  const streams = info.streams ?? [];
  const audio = streams.find((s) => s.codec_type === "audio");
  if (!audio) throw new DecodeError("no_audio");
  // capa de MP3/M4A (attached_pic) não é vídeo
  const kind = streams.some((s) => s.codec_type === "video" && !s.disposition?.attached_pic) ? "video" : "audio";
  const headerDuration = Number(audio.duration ?? info.format?.duration ?? 0);
  if (headerDuration > o.maxDurationS) throw new DecodeError("too_long");
  const sampleRate = Number(audio.sample_rate);
  const nch = Math.min(2, audio.channels ?? 0);
  if (!sampleRate || !nch) throw new DecodeError("decode");

  // float 32 intercalado, na taxa original; só os 2 primeiros canais, sem mixagem
  const pan = audio.channels && audio.channels > 2 ? ["-af", "pan=stereo|c0=c0|c1=c1"] : [];
  const out = await run(
    ffmpeg,
    ["-v", "error", "-nostdin", ...safe, "-i", path, "-map", `0:${audio.index}`, ...pan, "-c:a", "pcm_f32le", "-f", "f32le", "pipe:1"],
    timeoutS,
  );
  if (out.code !== 0) throw new DecodeError("decode");
  const frames = Math.floor(out.stdout.byteLength / 4 / nch);
  const all = new Float32Array(out.stdout.buffer, out.stdout.byteOffset, frames * nch);
  const left = new Float32Array(frames);
  const right = nch === 2 ? new Float32Array(frames) : null;
  for (let i = 0, k = 0; i < frames; i++) {
    left[i] = all[k++];
    if (right) right[i] = all[k++];
  }
  const channels = right && !sameSamples(left, right) ? [left, right] : [left];

  if (frames < sampleRate * 0.5) throw new DecodeError("no_audio");
  if (frames / sampleRate > o.maxDurationS) throw new DecodeError("too_long");
  return {
    kind,
    sampleRate,
    channels,
    audioStart: Math.max(0, Number(audio.start_time ?? 0)),
    duration: frames / sampleRate,
    codec: audio.codec_name ?? "?",
    container: info.format?.format_name ?? "?",
  };
}
