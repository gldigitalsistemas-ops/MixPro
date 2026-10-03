/**
 * Custo da parte de áudio de um ExportJob em Node: cada caso roda o run-export-job.ts num processo
 * novo (pico de memória isolado) e guarda tempo de relógio, CPU e RSS máximo.
 *
 * Uso (de apps/web; precisa das variáveis públicas do Supabase para os samples/IRs):
 *   ../../packages/contracts/node_modules/.bin/tsx --env-file=.env.local scripts/bench-export-job.ts [--minutos 1,3,10]
 * Saída: tabela no terminal e .cache/bench/resultado.json.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { cpus, totalmem } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import type { ChainDoc } from "@/lib/dsp/chain";
import type { DrumTweaks } from "@/lib/drums/tweaks";
import { buildExportJob, type ExportState } from "@/lib/export/build-job";

const { values: args } = parseArgs({ options: { minutos: { type: "string", default: "1,3,10" }, cadeias: { type: "string", default: "voz,guitarra,bateria" } } });
const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
const OUT = resolve(".cache/bench");
const CACHE = resolve(".cache/export-assets");
const SR = 48000;
const CHAINS: Record<string, ChainDoc> = JSON.parse(readFileSync("lib/export/fixtures/chains.json", "utf8"));
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));

/** WAV 16 bits (menor em disco) com 8 s de material repetido até a duração pedida. */
function pcm16File(path: string, minutes: number, channels: number, kind: string) {
  if (existsSync(path)) return;
  const n = Math.round(minutes * 60 * SR);
  const buf = Buffer.alloc(44 + n * channels * 2);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + n * channels * 2, 4);
  buf.write("WAVEfmt ", 8);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(channels, 22);
  buf.writeUInt32LE(SR, 24);
  buf.writeUInt32LE(SR * channels * 2, 28);
  buf.writeUInt16LE(channels * 2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(n * channels * 2, 40);
  let seed = 3;
  const noise = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff) * 2 - 1;
  for (let i = 0, o = 44; i < n; i++) {
    const t = (i % (SR * 8)) / SR;
    let v: number;
    if (kind === "bateria") {
      const beat = t % (60 / 110);
      v = beat < 0.4 ? (Math.floor(t / (60 / 110)) % 2 ? 0.5 * Math.exp(-beat / 0.08) * noise() : 0.8 * Math.exp(-beat / 0.12) * Math.sin(2 * Math.PI * 60 * beat)) : 0;
    } else if (kind === "guitarra") {
      const ct = t % 2;
      v = 0.12 * Math.exp(-ct / 0.6) * (Math.sin(2 * Math.PI * 196 * ct) + Math.sin(2 * Math.PI * 247 * ct) + Math.sin(2 * Math.PI * 294 * ct));
    } else {
      const on = t % 2 < 1.4;
      let s = 0;
      for (let h = 1; h <= 8; h++) s += Math.sin(2 * Math.PI * (150 + 20 * Math.sin(2 * Math.PI * 5 * t)) * h * t) / h;
      v = (on ? 0.18 * s : 0) + 0.004 * noise();
    }
    for (let c = 0; c < channels; c++, o += 2) buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(v * (c ? 0.9 : 1) * 32767))), o);
  }
  writeFileSync(path, buf);
}

async function main() {
  if (!URL_ || !KEY) throw new Error("defina NEXT_PUBLIC_SUPABASE_URL e NEXT_PUBLIC_SUPABASE_ANON_KEY (use --env-file=.env.local)");
  mkdirSync(OUT, { recursive: true });
  const rest = async <T,>(q: string): Promise<T> => (await fetch(`${URL_}/rest/v1/${q}`, { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } })).json() as Promise<T>;
  const drums = await rest<{ id: string; piece: string; files: string[]; room_files: string[] }[]>("drum_samples?select=id,piece,files,room_files&active=eq.true&order=position");
  const irs = await rest<{ id: string; kind: string; file: string }[]>("cab_irs?select=id,kind,file&active=eq.true&order=position");
  const first = (piece: string) => drums.find((d) => d.piece === piece)?.id ?? "synth";
  const guitarIR = irs.find((i) => i.kind === "guitar")!;
  const drumTweaks: DrumTweaks = {
    samples: { kick: first("kick"), snare: first("snare"), tom1: first("tom"), tom2: first("tom"), floor: first("floor"), rimshot: "synth" },
    kick: 0, snare: 0, toms: 0, floor: 0, kick_tune: 0, snare_tune: 0, toms_tune: 0, floor_tune: 0,
    rimshot: 0, room: 40, sample_mix: 75, reverb_size: "medium", reverb: 25, kick_sens: 50, snare_sens: 50, tom_sens: 50,
  };
  const guitarChain = clone(CHAINS["guitarra-amp-rock"]);
  guitarChain.chain[0].params = { ...guitarChain.chain[0].params, ir: guitarIR.id };
  const parts: Record<string, Pick<ExportState, "preset" | "chainParts" | "denoise">> = {
    voz: { preset: { slug: "criador-youtuber" }, chainParts: { base: clone(CHAINS["criador-youtuber"]), drums: null, reverb: null, master: null }, denoise: 0 },
    "voz+ruido": { preset: { slug: "criador-youtuber" }, chainParts: { base: clone(CHAINS["criador-youtuber"]), drums: null, reverb: null, master: null }, denoise: 0.9 },
    guitarra: { preset: { slug: "guitarra-amp-rock" }, chainParts: { base: guitarChain, drums: null, reverb: null, master: null }, denoise: 0 },
    bateria: { preset: { slug: "bateria-pop-rock" }, chainParts: { base: clone(CHAINS["bateria-pop-rock"]), drums: drumTweaks, reverb: null, master: null }, denoise: 0 },
  };
  const tsxCli = createRequire(resolve("../../packages/contracts/package.json")).resolve("tsx/cli");
  const results: Record<string, unknown>[] = [];
  const minutes = args.minutos!.split(",").map(Number);
  const chains = args.cadeias!.split(",");
  console.log(`máquina: ${cpus().length} núcleos lógicos, ${cpus()[0].model}, ${(totalmem() / 2 ** 30).toFixed(1)} GB, Node ${process.version}`);
  console.log("cadeia | min | canais | relógio (s) | CPU (s) | CPU/relógio | x tempo real | RSS pico (MB) | assets (s) | DSP+cortes (s)");
  for (const chain of chains)
    for (const m of minutes)
      for (const ch of [1, 2]) {
        const kind = chain.startsWith("voz") ? "voz" : chain;
        const input = join(OUT, `${kind}-${m}min-${ch}ch.wav`);
        pcm16File(input, m, ch, kind);
        const dur = m * 60;
        const state = {
          target: "wav",
          media: { file: { name: "x.wav", size: 1, lastModified: 0 }, kind: "audio", videoContainer: "mp4", sampleRate: SR, channels: Array.from({ length: ch }, () => new Float32Array(1)), audioStart: 0, duration: dur },
          customizing: false, intensity: 75, social: true, cutLevel: "off", segments: [{ start: 0, end: dur }], cutting: false,
          look: { format: "original", fit: "blur", watermark: false, captions: null, fontFamily: "Arial", color: null, cta: null },
          comparing: false, audiogram: null, music: null,
          library: { drums: drums.map((d) => ({ id: d.id, files: d.files, room_files: d.room_files })), irs: irs.map((i) => ({ id: i.id, file: i.file })) },
          buildId: "bench",
          ...parts[chain],
        } as ExportState;
        const job = buildExportJob(state);
        const jobPath = join(OUT, `job-${chain}-${ch}ch.json`);
        writeFileSync(jobPath, JSON.stringify(job));
        const r = spawnSync(process.execPath, ["--max-old-space-size=8192", tsxCli, "scripts/run-export-job.ts", "--job", jobPath, "--in", input, "--out", join(OUT, "saida.wav"), "--cache", CACHE, "--storage-url", URL_], { encoding: "utf8", maxBuffer: 1 << 24 });
        if (r.status !== 0) {
          console.log(`${chain} | ${m} | ${ch} | FALHOU: ${r.stderr.trim().split("\n").pop()}`);
          results.push({ chain, minutos: m, canais: ch, erro: r.stderr.trim().split("\n").pop() });
          continue;
        }
        const o = JSON.parse(r.stdout);
        const c = o.custo;
        const e = c.etapas_ms;
        results.push({ chain, minutos: m, canais: ch, ...c });
        console.log(
          [chain, m, ch, (c.relogio_ms / 1000).toFixed(1), (c.cpu_ms / 1000).toFixed(1), c.cpu_por_relogio, (dur / (c.relogio_ms / 1000)).toFixed(1), c.pico_rss_mb, ((e.assets - e.leitura) / 1000).toFixed(1), ((e.edicao - e.assets) / 1000).toFixed(1)].join(" | "),
        );
      }
  writeFileSync(join(OUT, "resultado.json"), JSON.stringify({ cpus: cpus().length, modelo: cpus()[0].model, ram_gb: totalmem() / 2 ** 30, node: process.version, results }, null, 1));
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
