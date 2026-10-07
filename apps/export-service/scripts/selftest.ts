(globalThis as Record<string, unknown>).WorkerGlobalScope ??= function WorkerGlobalScope() {};
/**
 * Autoteste do serviço, para rodar DENTRO da imagem (CI) ou localmente, sem rede:
 *  1. um job sintético de ponta a ponta (voz + remoção de ruído) pelo pipeline real, com
 *     armazenamento e jobs em pasta temporária: sha256_f32 igual ao caminho do app, e os três
 *     formatos de saída gravados;
 *  2. a decodificação do FFmpeg DESTA imagem contra a referência do app (Chrome + load.ts) em
 *     fixtures/decode-reference.json: PCM idêntico; AAC/MP3 com as mesmas amostras, canais, taxa e
 *     início, LUFS ±0,01 dB e pico ±1e-4 (a tabela mostra se ficou idêntico bit a bit).
 * Variáveis: FFMPEG_PATH, FFPROBE_PATH, FIXTURES_DIR (padrão: ../web/lib/export/fixtures).
 * Sai com código 1 se algo falhar. Só imprime medidas (nada de conteúdo).
 */
import { createHash, randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { ChainDoc } from "@/lib/dsp/chain";
import { integratedLoudness, samplePeak } from "@/lib/dsp/loudness";
import type { Signal } from "@/lib/dsp/types";
import { processJobAudio } from "@/lib/export/audio-job";
import { buildExportJob } from "@/lib/export/build-job";
import { decodeMedia, DecodeError } from "@/lib/export/ffmpeg-decode";
import { SYNTH_WAVS, synthWav } from "@/lib/export/synth-wav";
import { encodeWavFloat } from "@/lib/export/wav";
import { StaticCatalog } from "../src/adapters/catalog";
import { LocalJobStore } from "../src/adapters/jobs";
import { LocalStorage } from "../src/adapters/storage";
import { DEFAULT_LIMITS, runJob } from "../src/pipeline";

const FFMPEG = process.env.FFMPEG_PATH ?? "ffmpeg";
const FFPROBE = process.env.FFPROBE_PATH ?? "ffprobe";
const FIX = resolve(process.env.FIXTURES_DIR ?? "../web/lib/export/fixtures");
const SR = 48000;

const sha = (x: Signal) => {
  const h = createHash("sha256");
  for (const c of x) h.update(Buffer.from(c.buffer, c.byteOffset, c.byteLength));
  return h.digest("hex");
};
const out = (s: string) => process.stdout.write(s + "\n");

async function main() {
  let failures = 0;
  const dir = mkdtempSync(join(tmpdir(), "mixpro-selftest-"));
  try {
    // ---------------------------------------------------------------- 1. job de ponta a ponta
    const chains: Record<string, ChainDoc> = JSON.parse(readFileSync(join(FIX, "chains.json"), "utf8"));
    const x = new Float32Array(SR * 6);
    let seed = 1;
    for (let i = 0; i < x.length; i++) {
      const t = i / SR;
      if (t % 2 < 1.3) for (let h = 1; h <= 6; h++) x[i] += (0.15 / h) * Math.sin(2 * Math.PI * 150 * h * t);
      x[i] += 0.01 * (((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff) * 2 - 1);
    }
    const ch: Signal = [x, x.map((v) => v * 0.9)];
    const storage = new LocalStorage(join(dir, "armazenamento"));
    const jobs = new LocalJobStore(join(dir, "jobs.json"));
    const deps = { storage, jobs, catalog: new StaticCatalog(), ffmpeg: FFMPEG, ffprobe: FFPROBE, assetStorageUrl: "", assetMemory: new Map<string, Uint8Array>(), limits: DEFAULT_LIMITS };
    out("1. job de ponta a ponta (voz + remoção de ruído, 6 s)");
    for (const target of ["wav", "mp3", "m4a"] as const) {
      const job = buildExportJob({
        target,
        media: { file: { name: "x", size: 1, lastModified: 1 }, kind: "audio", videoContainer: "mp4", sampleRate: SR, channels: ch, audioStart: 0, duration: 6 },
        preset: { slug: "criador-youtuber" },
        chainParts: { base: chains["criador-youtuber"], drums: null, reverb: null, master: null },
        customizing: false, intensity: 75, denoise: 0.9, social: true, cutLevel: "off", segments: [{ start: 0, end: 6 }], cutting: false,
        look: { format: "original", fit: "blur", watermark: false, captions: null, fontFamily: "Arial", color: null, cta: null },
        comparing: false, audiogram: null, music: null, library: { drums: [], irs: [] }, buildId: "selftest",
      });
      const expected = sha(await processJobAudio(job, ch.map((c) => c.slice()), SR));
      const key = `in/${randomUUID()}`;
      await storage.put(key, encodeWavFloat(ch, SR));
      const rec = await jobs.create({ user_id: "00000000-0000-0000-0000-000000000001", job_json: JSON.stringify(job), input_key: key });
      const r = await runJob(rec.id, deps);
      const after = (await jobs.get(rec.id))!;
      const ok = r.status === "done" && after.measures?.sha256_f32 === expected && (after.measures?.output_bytes ?? 0) > 1000;
      if (!ok) failures++;
      out(`   ${target}: ${r.status}${r.error_code ? ` ${r.error_code}` : ""} · sha256_f32 ${after.measures?.sha256_f32 === expected ? "igual ao app" : "DIFERENTE"} · ${after.measures?.output_bytes ?? 0} bytes · ${ok ? "ok" : "FALHOU"}`);
    }

    // ---------------------------------------------------------------- 2. decodificação × referência do app
    out("2. decodificação do FFmpeg desta imagem × referência do app (Chrome + load.ts)");
    type Ref = { erro?: string; tipo?: string; taxa?: number; canais?: number; amostras?: number; audio_start?: number; sha256_f32?: string; lufs?: number; pico?: number };
    const refs: Record<string, Ref> = JSON.parse(readFileSync(join(FIX, "decode-reference.json"), "utf8")).arquivos;
    for (const s of SYNTH_WAVS) writeFileSync(join(dir, s.name), synthWav(s));
    for (const [key, ref] of Object.entries(refs)) {
      const path = key.startsWith("synth:") ? join(dir, key.slice(6)) : key.startsWith("lib/export/fixtures/") ? join(FIX, key.slice("lib/export/fixtures/".length)) : null;
      if (!path) {
        out(`   ${key}: fora da imagem (arquivo do projeto, coberto no CI do repositório)`);
        continue;
      }
      let line = "";
      try {
        const d = await decodeMedia(path, { ffmpeg: FFMPEG, ffprobe: FFPROBE, maxDurationS: 900 });
        if (ref.erro) {
          failures++;
          line = `FALHOU (o app recusa: ${ref.erro})`;
        } else {
          const exact = sha(d.channels) === ref.sha256_f32;
          const shape = d.kind === ref.tipo && d.sampleRate === ref.taxa && d.channels.length === ref.canais && d.channels[0].length === ref.amostras && Math.abs(d.audioStart - (ref.audio_start ?? 0)) <= 1 / d.sampleRate;
          const dl = integratedLoudness(d.channels, d.sampleRate) - ref.lufs!;
          const dp = samplePeak(d.channels) - ref.pico!;
          const ok = shape && (key.endsWith(".wav") ? exact : Math.abs(dl) <= 0.01 && Math.abs(dp) <= 1e-4);
          if (!ok) failures++;
          line = `${ok ? "ok" : "FALHOU"} · ${exact ? "idêntico bit a bit" : `ΔLUFS ${dl.toExponential(1)} · Δpico ${dp.toExponential(1)}`}${shape ? "" : " · forma diferente (amostras/canais/taxa/início)"}`;
        }
      } catch (e) {
        const code = e instanceof DecodeError ? e.code : "erro";
        const ok = ref.erro === code;
        if (!ok) failures++;
        line = ok ? `ok · ambos recusam (${code})` : `FALHOU (${code})`;
      }
      out(`   ${key}: ${line}`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  out(failures ? `FALHAS: ${failures}` : "tudo ok");
  process.exit(failures ? 1 : 0);
}

main().catch(() => {
  out("FALHOU: erro inesperado");
  process.exit(1);
});
