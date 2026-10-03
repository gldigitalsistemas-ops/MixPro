/**
 * Protótipo: grava MP3/M4A a partir do áudio JÁ PROCESSADO usando o FFmpeg nativo (o codificador
 * do app usa Web Audio/WebCodecs e não roda em Node). Não toca no DSP: recebe as amostras float
 * finais e só codifica. Taxas iguais às do app (mediabunny QUALITY_HIGH): MP3 ~320 kbps, AAC 192 kbps.
 *
 * Dither: o app grava o WAV com dither aleatório (lib/media/export.ts). MP3/AAC codificam a partir
 * do float, então aqui não há dither nem quantização para 16 bits (o mesmo vale no navegador).
 * M4A vai para um arquivo temporário: o contêiner MP4 grava o índice no fim e precisa voltar ao
 * início do arquivo ("faststart"), o que um pipe não permite.
 */
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Signal } from "@/lib/dsp/types";

export async function encodeWithFfmpeg(ffmpeg: string, channels: Signal, sampleRate: number, format: "mp3" | "m4a"): Promise<Uint8Array> {
  const dir = format === "m4a" ? await mkdtemp(join(tmpdir(), "mixpro-enc-")) : null;
  const target = dir ? join(dir, "saida.m4a") : "pipe:1";
  const codec = format === "mp3" ? ["-c:a", "libmp3lame", "-b:a", "320k", "-f", "mp3"] : ["-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", "-f", "ipod"];
  const args = ["-hide_banner", "-loglevel", "error", "-y", "-f", "f32le", "-ar", String(sampleRate), "-ac", String(channels.length), "-i", "pipe:0", ...codec, "-map_metadata", "-1", target];
  const proc = spawn(ffmpeg, args, { stdio: ["pipe", "pipe", "pipe"] });
  const chunks: Buffer[] = [];
  let err = "";
  proc.stdout.on("data", (c: Buffer) => chunks.push(c));
  proc.stderr.on("data", (c: Buffer) => (err += c));
  const done = new Promise<void>((resolve, reject) => {
    proc.on("error", reject);
    proc.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg saiu com ${code}: ${err.trim()}`))));
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
    return dir ? new Uint8Array(await readFile(target)) : new Uint8Array(Buffer.concat(chunks));
  } finally {
    if (dir) await rm(dir, { recursive: true, force: true });
  }
}
