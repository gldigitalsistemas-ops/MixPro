/**
 * Grava MP3/M4A a partir do áudio JÁ PROCESSADO usando o FFmpeg nativo (o codificador do app usa
 * Web Audio/WebCodecs e não roda em Node). Não toca no DSP: recebe as amostras float finais e só
 * codifica. Taxas iguais às do app (mediabunny QUALITY_HIGH): MP3 ~320 kbps, AAC 192 kbps.
 *
 * Dither: o app grava o WAV com dither aleatório (lib/media/export.ts). MP3/AAC codificam a partir
 * do float, então aqui não há dither nem quantização para 16 bits (o mesmo vale no navegador).
 * MP3 e M4A vão para um arquivo temporário: o MP4 grava o índice no fim e precisa voltar ao início
 * ("faststart"), e o MP3 só ganha o cabeçalho LAME/Xing completo (atraso do codificador, para os
 * players tocarem sem os 23 ms extras) voltando ao início — um pipe não permite nenhum dos dois.
 *
 * Segurança: entrada só pelo pipe, -threads 1, timeout. O texto de erro do FFmpeg não sai daqui.
 */
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Signal } from "@/lib/dsp/types";

export class EncodeError extends Error {
  constructor(public code: "encode" | "timeout") {
    super(code);
    this.name = "EncodeError";
  }
}

export async function encodeWithFfmpeg(
  ffmpeg: string,
  channels: Signal,
  sampleRate: number,
  format: "mp3" | "m4a" | "wav" | "wav24" | "flac",
  timeoutS = 300,
): Promise<Uint8Array> {
  const dir = await mkdtemp(join(tmpdir(), "mixpro-enc-"));
  const ext = format === "wav24" ? "wav" : format;
  const target = join(dir, `saida.${ext}`);
  const CODECS: Record<typeof format, string[]> = {
    mp3: ["-c:a", "libmp3lame", "-b:a", "320k", "-f", "mp3"],
    m4a: ["-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", "-f", "ipod"],
    // 16 bits com dither triangular (como o WAV do app); 24 bits e FLAC sem perda
    wav: ["-af", "aresample=osf=s16:dither_method=triangular", "-c:a", "pcm_s16le", "-f", "wav"],
    wav24: ["-c:a", "pcm_s24le", "-f", "wav"],
    flac: ["-af", "aresample=osf=s32", "-c:a", "flac", "-sample_fmt", "s32", "-bits_per_raw_sample", "24", "-f", "flac"],
  };
  const codec = CODECS[format];
  const args = [
    "-hide_banner", "-loglevel", "error", "-nostdin", "-y",
    "-protocol_whitelist", "pipe,file", "-threads", "1",
    "-f", "f32le", "-ar", String(sampleRate), "-ac", String(channels.length), "-i", "pipe:0",
    ...codec, "-map_metadata", "-1", target,
  ];
  const proc = spawn(ffmpeg, args, { stdio: ["pipe", "ignore", "ignore"] });
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    proc.kill("SIGKILL");
  }, timeoutS * 1000);
  const done = new Promise<void>((resolve, reject) => {
    proc.on("error", reject);
    proc.on("close", (code) => (code === 0 ? resolve() : reject(new EncodeError(timedOut ? "timeout" : "encode"))));
  });
  // se o ffmpeg parar antes, o erro dele (em `done`) é o que importa
  proc.stdin.on("error", () => {});
  try {
    // amostras intercaladas (L R L R…), em blocos de 1 s para não duplicar o áudio inteiro na memória
    const n = channels[0].length;
    const nch = channels.length;
    for (let pos = 0; pos < n && proc.exitCode === null; pos += sampleRate) {
      const len = Math.min(sampleRate, n - pos);
      const buf = Buffer.allocUnsafe(len * nch * 4);
      for (let i = 0, o = 0; i < len; i++) for (let c = 0; c < nch; c++, o += 4) buf.writeFloatLE(channels[c][pos + i], o);
      if (!proc.stdin.write(buf)) await new Promise((r) => proc.stdin.once("drain", r));
    }
    proc.stdin.end();
    await done;
    return new Uint8Array(await readFile(target));
  } finally {
    clearTimeout(timer);
    await rm(dir, { recursive: true, force: true });
  }
}

/**
 * Passa o áudio por um filtro do FFmpeg (ex.: rubberband para tom e andamento) e devolve as amostras.
 * Entrada e saída em float pelos pipes; o filtro vem só do código do serviço (nunca do usuário).
 */
export async function filterWithFfmpeg(ffmpeg: string, channels: Signal, sampleRate: number, filter: string, timeoutS = 300): Promise<Signal> {
  const nch = channels.length;
  const args = [
    "-hide_banner", "-loglevel", "error", "-nostdin",
    "-protocol_whitelist", "pipe", "-threads", "1",
    "-f", "f32le", "-ar", String(sampleRate), "-ac", String(nch), "-i", "pipe:0",
    "-af", filter, "-f", "f32le", "-ar", String(sampleRate), "-ac", String(nch), "pipe:1",
  ];
  const proc = spawn(ffmpeg, args, { stdio: ["pipe", "pipe", "ignore"] });
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    proc.kill("SIGKILL");
  }, timeoutS * 1000);
  const chunks: Buffer[] = [];
  proc.stdout.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<void>((resolve, reject) => {
    proc.on("error", reject);
    proc.on("close", (code) => (code === 0 ? resolve() : reject(new EncodeError(timedOut ? "timeout" : "encode"))));
  });
  proc.stdin.on("error", () => {});
  try {
    const n = channels[0].length;
    for (let pos = 0; pos < n && proc.exitCode === null; pos += sampleRate) {
      const len = Math.min(sampleRate, n - pos);
      const buf = Buffer.allocUnsafe(len * nch * 4);
      for (let i = 0, o = 0; i < len; i++) for (let c = 0; c < nch; c++, o += 4) buf.writeFloatLE(channels[c][pos + i], o);
      if (!proc.stdin.write(buf)) await new Promise((r) => proc.stdin.once("drain", r));
    }
    proc.stdin.end();
    await done;
  } finally {
    clearTimeout(timer);
  }
  const all = Buffer.concat(chunks);
  const frames = Math.floor(all.length / (4 * nch));
  const out = Array.from({ length: nch }, () => new Float32Array(frames)) as Signal;
  for (let i = 0, o = 0; i < frames; i++) for (let c = 0; c < nch; c++, o += 4) out[c][i] = all.readFloatLE(o);
  return out;
}
