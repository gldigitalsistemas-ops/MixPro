"use client";

import { ALL_FORMATS, AudioBufferSink, BlobSource, Input, MATROSKA, WEBM } from "mediabunny";
import type { Signal } from "@/lib/dsp/types";
import { isPhone } from "@/lib/device";

export type LoadedMedia = {
  file: File;
  kind: "video" | "audio";
  /** Contêiner da saída de vídeo que preserva o vídeo original sem recodificar. */
  videoContainer: "mp4" | "webm";
  sampleRate: number;
  channels: Signal;
  /** Instante (s) da primeira amostra de áudio no arquivo — mantém o sincronismo com o vídeo. */
  audioStart: number;
  duration: number;
};

export class MediaLoadError extends Error {
  constructor(
    public code: "no_audio" | "unsupported" | "too_long" | "decode",
    message: string,
  ) {
    super(message);
  }
}

/**
 * Duração máxima: todo o áudio fica na memória (e é copiado ao processar e exportar).
 * No celular o navegador fecha a página perto de 1 GB, então o limite é menor, e menor ainda
 * para vídeo (montar o vídeo quadro a quadro também ocupa memória).
 */
export const maxDurationS = (kind: LoadedMedia["kind"]) => (isPhone() ? (kind === "video" ? 5 : 10) : 15) * 60;

const MESSAGES = {
  no_audio: "Esse vídeo não tem som. Escolha um vídeo com áudio.",
  unsupported: "Não conseguimos abrir esse arquivo. Tente um vídeo MP4/MOV ou um áudio MP3, WAV ou M4A.",
  too_long: "",
  decode: "Não foi possível ler o áudio desse arquivo neste navegador. Tente pelo Chrome ou envie outro formato.",
};

const fail = (code: keyof typeof MESSAGES, kind: LoadedMedia["kind"] = "audio") =>
  new MediaLoadError(
    code,
    code === "too_long"
      ? `${kind === "video" ? "O vídeo" : "O áudio"} tem mais de ${maxDurationS(kind) / 60} minutos${isPhone() ? ` (limite ${kind === "video" ? "de vídeo " : ""}no celular)` : ""}. Corte um trecho menor e tente de novo.`
      : MESSAGES[code],
  );

/** Mantém no máximo 2 canais (estéreo); mono continua mono. */
function toStereoAtMost(chs: Signal): Signal {
  return chs.length > 2 ? chs.slice(0, 2) : chs;
}

async function decodeWithMediabunny(
  input: Input,
  kind: LoadedMedia["kind"],
  onProgress: (v: number) => void,
): Promise<{ channels: Signal; sampleRate: number; start: number; duration: number }> {
  const track = await input.getPrimaryAudioTrack();
  if (!track) throw fail("no_audio");
  if (!(await track.canDecode())) throw fail("decode");

  const duration = await track.computeDuration();
  if (duration > maxDurationS(kind)) throw fail("too_long", kind);
  const start = Math.max(0, await track.getFirstTimestamp());
  const sr = track.sampleRate;
  const nch = Math.min(2, track.numberOfChannels);

  // memória: o segundo canal só existe se for diferente do primeiro (muito celular grava mono
  // duplicado em estéreo) e o resultado não é copiado no final (só ~1 s de folga sobra no buffer)
  let cap = Math.ceil((duration - start) * sr) + sr;
  let left: Float32Array<ArrayBuffer> = new Float32Array(cap);
  let right: Float32Array<ArrayBuffer> | null = null;
  let scratch: Float32Array<ArrayBuffer> = new Float32Array(0);
  let len = 0;
  const grow = (a: Float32Array<ArrayBuffer>) => {
    const next = new Float32Array(cap);
    next.set(a.subarray(0, len));
    return next;
  };
  const sink = new AudioBufferSink(track);
  for await (const { buffer } of sink.buffers()) {
    const n = buffer.length;
    if (len + n > cap) {
      cap = Math.ceil((len + n) * 1.25);
      left = grow(left);
      if (right) right = grow(right);
    }
    buffer.copyFromChannel(left.subarray(len, len + n), 0);
    if (nch === 2 && buffer.numberOfChannels > 1) {
      if (right) buffer.copyFromChannel(right.subarray(len, len + n), 1);
      else {
        if (scratch.length < n) scratch = new Float32Array(n);
        buffer.copyFromChannel(scratch.subarray(0, n), 1);
        if (!sameSamples(left.subarray(len, len + n), scratch.subarray(0, n))) {
          right = grow(left);
          right.set(scratch.subarray(0, n), len);
        }
      }
    }
    len += n;
    if (duration > 0) onProgress(Math.min(1, len / sr / duration));
  }
  const channels = (right ? [left, right] : [left]).map((ch) => ch.subarray(0, len));
  return { channels, sampleRate: sr, start, duration: len / sr };
}

function sameSamples(a: Float32Array, b: Float32Array): boolean {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** Reserva para navegadores sem WebCodecs: o próprio navegador decodifica o arquivo inteiro. */
async function decodeWithWebAudio(file: File, kind: LoadedMedia["kind"]) {
  const ctx = new OfflineAudioContext(1, 1, 48000);
  const buffer = await ctx.decodeAudioData(await file.arrayBuffer()).catch(() => {
    throw fail("decode");
  });
  if (buffer.duration > maxDurationS(kind)) throw fail("too_long", kind);
  const first = buffer.getChannelData(0);
  const second = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : null;
  // mono duplicado em estéreo vira um canal só (metade da memória)
  const channels = second && !sameSamples(first, second) ? [first.slice(), second.slice()] : [first.slice()];
  return { channels, sampleRate: buffer.sampleRate, start: 0, duration: buffer.duration };
}

export async function loadMedia(file: File, onProgress: (v: number) => void): Promise<LoadedMedia> {
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  let kind: LoadedMedia["kind"] = file.type.startsWith("video/") ? "video" : "audio";
  let videoContainer: LoadedMedia["videoContainer"] = "mp4";
  let decoded: Awaited<ReturnType<typeof decodeWithMediabunny>>;

  try {
    const format = await input.getFormat();
    if (format === WEBM || format === MATROSKA) videoContainer = "webm";
    kind = (await input.getPrimaryVideoTrack()) ? "video" : "audio";
    decoded = await decodeWithMediabunny(input, kind, onProgress);
  } catch (err) {
    if (err instanceof MediaLoadError && err.code !== "decode") throw err;
    decoded = await decodeWithWebAudio(file, kind);
  } finally {
    input.dispose();
  }

  if (!decoded.channels.length || decoded.channels[0].length < decoded.sampleRate * 0.5) throw fail("no_audio");
  return {
    file,
    kind,
    videoContainer,
    sampleRate: decoded.sampleRate,
    channels: toStereoAtMost(decoded.channels),
    audioStart: decoded.start,
    duration: decoded.duration,
  };
}
