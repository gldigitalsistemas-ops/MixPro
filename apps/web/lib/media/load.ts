"use client";

import { ALL_FORMATS, AudioBufferSink, BlobSource, Input, MATROSKA, WEBM } from "mediabunny";
import type { Signal } from "@/lib/dsp/types";

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
 * No celular o navegador fecha a página perto de 1 GB, então o limite é menor.
 */
const isPhone = () => typeof navigator !== "undefined" && /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
export const maxDurationS = () => (isPhone() ? 10 : 15) * 60;

const MESSAGES = {
  no_audio: "Esse vídeo não tem som. Escolha um vídeo com áudio.",
  unsupported: "Não conseguimos abrir esse arquivo. Tente um vídeo MP4/MOV ou um áudio MP3, WAV ou M4A.",
  too_long: "",
  decode: "Não foi possível ler o áudio desse arquivo neste navegador. Tente pelo Chrome ou envie outro formato.",
};

const fail = (code: keyof typeof MESSAGES) =>
  new MediaLoadError(
    code,
    code === "too_long"
      ? `O arquivo tem mais de ${maxDurationS() / 60} minutos${isPhone() ? " (limite no celular)" : ""}. Corte um trecho menor e tente de novo.`
      : MESSAGES[code],
  );

/** Mantém no máximo 2 canais (estéreo); mono continua mono. */
function toStereoAtMost(chs: Signal): Signal {
  return chs.length > 2 ? chs.slice(0, 2) : chs;
}

async function decodeWithMediabunny(
  input: Input,
  onProgress: (v: number) => void,
): Promise<{ channels: Signal; sampleRate: number; start: number; duration: number }> {
  const track = await input.getPrimaryAudioTrack();
  if (!track) throw fail("no_audio");
  if (!(await track.canDecode())) throw fail("decode");

  const duration = await track.computeDuration();
  if (duration > maxDurationS()) throw fail("too_long");
  const start = Math.max(0, await track.getFirstTimestamp());
  const sr = track.sampleRate;
  const nch = Math.min(2, track.numberOfChannels);

  let cap = Math.ceil((duration - start) * sr) + sr;
  let out = Array.from({ length: nch }, () => new Float32Array(cap));
  let len = 0;
  const sink = new AudioBufferSink(track);
  for await (const { buffer } of sink.buffers()) {
    if (len + buffer.length > cap) {
      cap = Math.ceil((len + buffer.length) * 1.25);
      out = out.map((ch) => {
        const next = new Float32Array(cap);
        next.set(ch.subarray(0, len));
        return next;
      });
    }
    for (let c = 0; c < nch; c++) {
      buffer.copyFromChannel(out[c].subarray(len, len + buffer.length), Math.min(c, buffer.numberOfChannels - 1));
    }
    len += buffer.length;
    if (duration > 0) onProgress(Math.min(1, len / sr / duration));
  }
  return { channels: out.map((ch) => ch.slice(0, len)), sampleRate: sr, start, duration: len / sr };
}

/** Reserva para navegadores sem WebCodecs: o próprio navegador decodifica o arquivo inteiro. */
async function decodeWithWebAudio(file: File) {
  const ctx = new OfflineAudioContext(1, 1, 48000);
  const buffer = await ctx.decodeAudioData(await file.arrayBuffer()).catch(() => {
    throw fail("decode");
  });
  if (buffer.duration > maxDurationS()) throw fail("too_long");
  const channels = Array.from({ length: Math.min(2, buffer.numberOfChannels) }, (_, c) => buffer.getChannelData(c).slice());
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
    decoded = await decodeWithMediabunny(input, onProgress);
  } catch (err) {
    if (err instanceof MediaLoadError && err.code !== "decode") throw err;
    decoded = await decodeWithWebAudio(file);
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
