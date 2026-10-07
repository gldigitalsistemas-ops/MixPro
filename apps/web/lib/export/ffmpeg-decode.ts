/**
 * Decodificação da mídia do usuário NO SERVIDOR (FFmpeg nativo), com as mesmas regras do app
 * (lib/media/load.ts):
 *  - taxa ORIGINAL do arquivo (sem reamostrar);
 *  - MP4/MOV: a edit list é aplicada com a regra do mediabunny (lib/export/mp4-edits.ts): o trecho
 *    antes de t=0 (pré-enchimento do AAC) é descartado, o FIM NÃO é cortado, e
 *    audioStart = max(0, primeiro instante do áudio). O FFmpeg roda com -ignore_editlist;
 *  - MP3: como o mediabunny, NÃO aplica o atraso/enchimento do cabeçalho LAME (o FFmpeg descartaria,
 *    o app não); audioStart = 0; e os valores são LIMITADOS a ±1, porque o decodificador de MP3 do
 *    Chrome limita. Medido: AAC e WAV float NÃO são limitados pelo app (limitar só pioraria);
 *  - no máximo 2 canais; estéreo com os dois canais idênticos vira mono;
 *  - áudio com menos de 0,5 s é recusado (no_audio);
 *  - duração acima do limite é recusada pelo CABEÇALHO, antes de decodificar.
 *
 * Entrada: um arquivo local OU um fluxo (o serviço lê do armazenamento direto para o stdin do
 * FFmpeg, sem gravar em disco). Em fluxo, MP4 precisa do índice (moov) antes dos dados — é assim
 * que o aparelho envia a trilha de áudio (mediabunny, fastStart).
 *
 * Segurança: só os protocolos pipe/file, -threads 1, timeout por processo, -loglevel error. O
 * texto de erro do FFmpeg NUNCA sai daqui: vira um código fechado (DecodeErrorCode).
 * Só em Node.
 */
import { spawn } from "node:child_process";
import type { Readable } from "node:stream";
import type { Signal } from "@/lib/dsp/types";
import { mediabunnyOffset, readMp4Edits, readMp4EditsFromStream, type Mp4Edits } from "./mp4-edits";

export type DecodeErrorCode =
  | "no_audio"
  | "unsupported"
  | "too_long"
  | "decode"
  /** Codec ou contêiner fora da lista permitida. */
  | "codec"
  /** MP4 com o índice depois dos dados, lido em fluxo. */
  | "layout"
  /** O arquivo termina antes do que o cabeçalho diz (cortado no envio). */
  | "truncated"
  | "timeout";

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
  /** Duração declarada no cabeçalho (s), quando existe. */
  headerDuration: number | null;
};

/** Um arquivo local, ou uma fábrica de fluxos (cada chamada abre a leitura de novo, do início). */
export type MediaInput = string | { open: () => Readable };

export type DecodeOptions = {
  ffmpeg?: string;
  ffprobe?: string;
  maxDurationS: number;
  /** Encerra cada processo do FFmpeg se passar disso (s). */
  timeoutS?: number;
  /** Se definido, só estes contêineres (format_name do FFmpeg) e codecs são aceitos. */
  allow?: { containers: RegExp; codecs: RegExp };
};

type Probe = {
  streams?: { index: number; codec_type: string; codec_name?: string; sample_rate?: string; channels?: number; start_time?: string; duration?: string; disposition?: { attached_pic?: number } }[];
  format?: { format_name?: string; duration?: string };
};

type RunResult = { code: number | null; stdout: Buffer; timedOut: boolean };

/** Roda um processo; a entrada vem do arquivo (no argumento) ou de um fluxo no stdin. */
function run(cmd: string, args: string[], timeoutS: number, stdin?: Readable): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: [stdin ? "pipe" : "ignore", "pipe", "ignore"] });
    const chunks: Buffer[] = [];
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      p.kill("SIGKILL");
    }, timeoutS * 1000);
    p.stdout?.on("data", (c: Buffer) => chunks.push(c));
    if (stdin && p.stdin) {
      // o FFmpeg pode parar de ler antes do fim (ex.: ffprobe): isso não é erro
      p.stdin.on("error", () => {});
      stdin.on("error", () => p.kill("SIGKILL"));
      stdin.pipe(p.stdin);
    }
    p.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    p.on("close", (code) => {
      clearTimeout(timer);
      stdin?.destroy();
      resolve({ code, stdout: Buffer.concat(chunks), timedOut });
    });
  });
}

/** Mesmo teste do app: o segundo canal só existe se for diferente do primeiro. */
function sameSamples(a: Float32Array, b: Float32Array): boolean {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

export async function decodeMedia(input: MediaInput, o: DecodeOptions): Promise<DecodedMedia> {
  const ffmpeg = o.ffmpeg ?? "ffmpeg";
  const ffprobe = o.ffprobe ?? "ffprobe";
  const timeoutS = o.timeoutS ?? 300;
  const file = typeof input === "string" ? input : null;
  // entrada: arquivo local ou stdin; nada de rede, listas ou concatenação
  const src = file ?? "pipe:0";
  const stream = () => (typeof input === "string" ? undefined : input.open());
  const safe = ["-protocol_whitelist", file ? "file" : "pipe", "-threads", "1"];
  const check = (r: RunResult) => {
    if (r.timedOut) throw new DecodeError("timeout");
  };

  const probe = await run(ffprobe, ["-v", "error", ...safe, "-show_streams", "-show_format", "-of", "json", "-i", src], 60, stream());
  check(probe);
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
  const container = info.format?.format_name ?? "";
  if (o.allow && (!o.allow.containers.test(container) || !o.allow.codecs.test(audio.codec_name ?? ""))) throw new DecodeError("codec");
  // capa de MP3/M4A (attached_pic) não é vídeo
  const kind = streams.some((s) => s.codec_type === "video" && !s.disposition?.attached_pic) ? "video" : "audio";
  const declared = Number(audio.duration ?? info.format?.duration ?? NaN);
  const headerDuration = Number.isFinite(declared) && declared > 0 ? declared : null;
  if (headerDuration !== null && headerDuration > o.maxDurationS) throw new DecodeError("too_long");
  const sampleRate = Number(audio.sample_rate);
  const nch = Math.min(2, audio.channels ?? 0);
  if (!sampleRate || !nch) throw new DecodeError("decode");

  const isMp4 = /(^|,)(mov|mp4)(,|$)/.test(container);
  const isMp3 = audio.codec_name === "mp3";
  const isWav = /(^|,)wav(,|$)/.test(container);

  // início como o mediabunny calcula (ver o cabeçalho deste arquivo)
  let skip = 0;
  let audioStart = Math.max(0, Number(audio.start_time ?? 0));
  if (isMp4) {
    let edits: Mp4Edits | null;
    if (file) edits = await readMp4Edits(file);
    else {
      const r = await readMp4EditsFromStream(stream()!);
      if (r.mdatFirst) throw new DecodeError("layout");
      edits = r.edits;
    }
    const audioTracks = edits?.tracks.filter((t) => t.handler === "soun") ?? [];
    const order = streams.filter((s) => s.codec_type === "audio").indexOf(audio);
    const track = audioTracks[order];
    if (!edits || !track) throw new DecodeError("decode");
    const { offset } = mediabunnyOffset(track, edits.movieTimescale);
    const first = await run(
      ffprobe,
      ["-v", "error", ...safe, "-ignore_editlist", "1", "-select_streams", `a:${order}`, "-show_entries", "packet=pts", "-read_intervals", "%+#1", "-of", "csv=p=0", "-i", src],
      60,
      stream(),
    );
    check(first);
    const firstPts = Number(first.stdout.toString("utf8").trim().split(/\s+/)[0] || 0);
    const firstS = (firstPts - offset) / track.timescale;
    skip = firstS < 0 ? Math.round(-firstS * sampleRate) : 0;
    audioStart = Math.max(0, firstS);
  } else if (isMp3) audioStart = 0;

  // float 32 intercalado, na taxa original; só os 2 primeiros canais, sem mixagem
  const pan = audio.channels && audio.channels > 2 ? ["-af", "pan=stereo|c0=c0|c1=c1"] : [];
  const inputOpts = isMp4 ? ["-ignore_editlist", "1"] : isMp3 ? ["-flags2", "+skip_manual"] : [];
  const out = await run(
    ffmpeg,
    ["-v", "error", "-nostdin", ...safe, ...inputOpts, "-i", src, "-map", `0:${audio.index}`, ...pan, "-c:a", "pcm_f32le", "-f", "f32le", "pipe:1"],
    timeoutS,
    stream(),
  );
  check(out);
  if (out.code !== 0) throw new DecodeError("decode");
  const total = Math.floor(out.stdout.byteLength / 4 / nch);
  const all = new Float32Array(out.stdout.buffer, out.stdout.byteOffset, total * nch);
  const frames = Math.max(0, total - skip);
  const left = new Float32Array(frames);
  const right = nch === 2 ? new Float32Array(frames) : null;
  for (let i = 0, k = skip * nch; i < frames; i++) {
    left[i] = all[k++];
    if (right) right[i] = all[k++];
  }
  // MP3: o decodificador do Chrome entrega no máximo ±1 (medido na paridade); AAC e WAV não
  if (isMp3)
    for (const ch of right ? [left, right] : [left])
      for (let i = 0; i < ch.length; i++) ch[i] = Math.max(-1, Math.min(1, ch[i]));
  const channels = right && !sameSamples(left, right) ? [left, right] : [left];

  if (frames < sampleRate * 0.5) throw new DecodeError("no_audio");
  if (frames / sampleRate > o.maxDurationS) throw new DecodeError("too_long");
  // cortado no envio: menos áudio do que o cabeçalho garante (MP4 e WAV têm duração exata no cabeçalho;
  // no MP4 o fim não é cortado, então o decodificado nunca fica abaixo dela num arquivo inteiro)
  if ((isMp4 || isWav) && headerDuration !== null && frames / sampleRate < headerDuration - 0.1) throw new DecodeError("truncated");
  return {
    kind,
    sampleRate,
    channels,
    audioStart,
    duration: frames / sampleRate,
    codec: audio.codec_name ?? "?",
    container: container || "?",
    headerDuration,
  };
}
