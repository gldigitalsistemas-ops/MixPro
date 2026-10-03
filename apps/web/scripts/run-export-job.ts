/**
 * Executa a parte de ÁUDIO de um ExportJob em Node, com o mesmo código do app:
 *   WAV de entrada → samples/IRs do job → processJobAudio (lib/export/audio-job.ts: processAudio →
 *   cortes → música de fundo) → gravação (exportAudio de lib/media/export.ts, com o mesmo dither).
 *
 * Uso (de apps/web):
 *   ../../packages/contracts/node_modules/.bin/tsx scripts/run-export-job.ts \
 *     --job job.json --in entrada.wav --out saida.wav [--music musica.wav] [--seed 123] \
 *     [--cache .cache/assets] [--storage-url https://xxxx.supabase.co] [--ffmpeg caminho/ffmpeg]
 *
 * --storage-url: padrão NEXT_PUBLIC_SUPABASE_URL (URL pública; o bucket é público, sem chave).
 * --seed: fixa o sorteio do dither (Math.random) só neste processo, para comparar arquivos.
 * --ffmpeg: grava MP3/M4A pelo FFmpeg nativo (o codificador do app não roda em Node).
 * Imprime um JSON com duração, amostras, LUFS, pico, impressão digital e custo (tempo, CPU, memória).
 */
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { exportJobSchema } from "@mixpro/contracts";
import { integratedLoudness, samplePeak } from "@/lib/dsp/loudness";
import type { Signal } from "@/lib/dsp/types";
import { exportAudio } from "@/lib/media/export";
import type { LoadedMedia } from "@/lib/media/load";
import { prepareMusic } from "@/lib/media/music";
import { encodeWithFfmpeg } from "./ffmpeg-encode";
import { loadJobAssets } from "@/lib/export/node-assets";
import { processJobAudio } from "@/lib/export/audio-job";
import { decodeWav } from "@/lib/export/wav";

// O pacote do RNNoise só aceita carregar "na web" (window ou worker): em Node basta declarar o
// ambiente de worker. É a única adaptação de ambiente que a parte de áudio precisa.
(globalThis as Record<string, unknown>).WorkerGlobalScope ??= function WorkerGlobalScope() {};

const { values: a } = parseArgs({
  options: {
    job: { type: "string" },
    in: { type: "string" },
    out: { type: "string" },
    music: { type: "string" },
    seed: { type: "string" },
    cache: { type: "string", default: ".cache/export-assets" },
    "storage-url": { type: "string" },
    ffmpeg: { type: "string" },
    "float-out": { type: "string" },
  },
});
if (!a.job || !a.in || !a.out) {
  console.error("uso: run-export-job.ts --job job.json --in entrada.wav --out saida.wav [--music m.wav] [--seed n] [--ffmpeg path]");
  process.exit(2);
}

/** Mesmo gerador usado nos testes do navegador (mulberry32). */
function seeded(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const sha = (x: Signal) => {
  const h = createHash("sha256");
  for (const ch of x) h.update(Buffer.from(ch.buffer, ch.byteOffset, ch.byteLength));
  return h.digest("hex");
};

const t0 = performance.now();
const cpu0 = process.cpuUsage();
const marks: Record<string, number> = {};
const mark = (k: string) => (marks[k] = Math.round(performance.now() - t0));

async function main() {
  const [jobPath, inPath, outPath] = [a.job!, a.in!, a.out!];
  const job = exportJobSchema.parse(JSON.parse(await readFile(jobPath, "utf8")));
  const input = decodeWav(await readFile(inPath));
  const sr = input.sampleRate;
  if (sr !== job.source.sample_rate || input.channels.length !== job.source.channels)
    throw new Error(`entrada ${sr} Hz / ${input.channels.length} canais ≠ job ${job.source.sample_rate} Hz / ${job.source.channels} canais`);
  mark("leitura");

  const storageUrl = a["storage-url"] ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const needsStorage = job.audio.assets.drum_samples.some((d) => !d.builtin) || job.audio.assets.irs.some((i) => !i.builtin);
  if (needsStorage && !storageUrl) throw new Error("o job usa samples/IRs do Storage: informe --storage-url");
  const assets = await loadJobAssets(job, sr, { storageUrl, cacheDir: a.cache! });
  mark("assets");

  // música de fundo (quando houver) na taxa e nos canais do áudio, como o music-picker faz
  let music = null;
  if (job.audio.music) {
    if (!a.music) throw new Error("o job tem música de fundo: informe --music (WAV)");
    const m = decodeWav(await readFile(a.music));
    music = prepareMusic({ name: "musica", channels: m.channels, sampleRate: m.sampleRate }, sr, input.channels.length);
  }
  // mesmo caminho do executeExportJob para arquivo de áudio: DSP → cortes → música
  const out = await processJobAudio(job, input.channels, sr, { drumSamples: assets.drumSamples, impulses: assets.impulses, music });
  mark("edicao");
  if (a["float-out"]) await writeFile(a["float-out"], Buffer.concat(out.map((c) => Buffer.from(c.buffer, c.byteOffset, c.byteLength))));

  const target = job.output.target;
  const format = target === "video" ? "wav" : target;
  let bytes: Uint8Array;
  if (format === "wav") {
    const media = { file: new File([], "audio.wav"), sampleRate: sr } as unknown as LoadedMedia;
    const random = Math.random;
    if (a.seed) Math.random = seeded(Number(a.seed));
    try {
      bytes = new Uint8Array(await (await exportAudio(media, out, "wav", () => {})).blob.arrayBuffer());
    } finally {
      Math.random = random;
    }
  } else {
    if (!a.ffmpeg) throw new Error(`${format.toUpperCase()} não roda em Node com o codificador do app (Web Audio/WebCodecs): use --ffmpeg`);
    bytes = await encodeWithFfmpeg(a.ffmpeg, out, sr, format);
  }
  await writeFile(outPath, bytes);
  mark("gravacao");

  const cpu = process.cpuUsage(cpu0);
  const wall = performance.now() - t0;
  console.log(
    JSON.stringify(
      {
        saida: outPath,
        formato: format,
        duracao_s: out[0].length / sr,
        amostras: out[0].length,
        canais: out.length,
        taxa: sr,
        lufs: integratedLoudness(out, sr),
        pico: samplePeak(out),
        sha256_f32: sha(out),
        sha256_arquivo: createHash("sha256").update(bytes).digest("hex"),
        assets: { aproximado: assets.approximate, baixados: assets.downloads, do_cache: assets.cacheHits },
        custo: {
          relogio_ms: Math.round(wall),
          cpu_ms: Math.round((cpu.user + cpu.system) / 1000),
          cpu_por_relogio: +((cpu.user + cpu.system) / 1000 / wall).toFixed(2),
          pico_rss_mb: Math.round(process.resourceUsage().maxRSS / 1024),
          etapas_ms: marks,
        },
      },
      null,
      1,
    ),
  );
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
