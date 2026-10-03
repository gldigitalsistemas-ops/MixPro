/**
 * Paridade da parte de áudio do ExportJob: (a) caminho do app em processo (buildExportJob →
 * processAudio → cortes → exportAudio) contra (b) o script run-export-job.ts lendo o job em JSON e
 * o WAV do disco, num processo separado. Usa a biblioteca real de samples/IRs (só leitura).
 *
 * Uso (de apps/web):
 *   ../../packages/contracts/node_modules/.bin/tsx --env-file=.env.local scripts/parity-export-job.ts
 * Precisa de NEXT_PUBLIC_SUPABASE_URL e NEXT_PUBLIC_SUPABASE_ANON_KEY (públicas, as mesmas do app).
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import type { ExportJob } from "@mixpro/contracts";
import type { ChainDoc } from "@/lib/dsp/chain";
import { integratedLoudness, samplePeak } from "@/lib/dsp/loudness";
import type { Signal } from "@/lib/dsp/types";
import type { DrumTweaks } from "@/lib/drums/tweaks";
import { buildExportJob, type ExportState } from "@/lib/export/build-job";
import { loadJobAssets } from "@/lib/export/node-assets";
import { processAudio } from "@/lib/export/process-audio";
import { encodeWavFloat } from "@/lib/export/wav";
import { spliceAudio } from "@/lib/media/cuts";
import { exportAudio } from "@/lib/media/export";
import type { LoadedMedia } from "@/lib/media/load";

(globalThis as Record<string, unknown>).WorkerGlobalScope ??= function WorkerGlobalScope() {};

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
if (!URL_ || !KEY) throw new Error("defina NEXT_PUBLIC_SUPABASE_URL e NEXT_PUBLIC_SUPABASE_ANON_KEY (use --env-file=.env.local)");
const OUT = resolve(".cache/parity");
const CACHE = resolve(".cache/export-assets");
const CHAINS: Record<string, ChainDoc> = JSON.parse(readFileSync("lib/export/fixtures/chains.json", "utf8"));
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
const SEED = 4242;

async function main() {
  // ------------------------------------------------------------------ biblioteca real (REST público)
  const rest = async <T,>(q: string): Promise<T> => {
    const r = await fetch(`${URL_}/rest/v1/${q}`, { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } });
    if (!r.ok) throw new Error(`${q}: ${r.status}`);
    return r.json() as Promise<T>;
  };
  type Sample = { id: string; piece: string; files: string[]; room_files: string[] };
  type IR = { id: string; kind: string; file: string };
  const drums = await rest<Sample[]>("drum_samples?select=id,piece,files,room_files&active=eq.true&order=position");
  const irs = await rest<IR[]>("cab_irs?select=id,kind,file&active=eq.true&order=position");
  const first = (piece: string) => drums.find((d) => d.piece === piece)?.id ?? "synth";
  const guitarIR = irs.find((i) => i.kind === "guitar");
  if (!guitarIR) throw new Error("nenhuma IR de guitarra enviada no banco");

  // ------------------------------------------------------------------ sinais de entrada (determinísticos)
  function rng(seed: number) {
    return () => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function voice(sr: number, seconds: number, noise: number): Signal {
    const r = rng(1);
    const x = new Float32Array(sr * seconds);
    for (const [a, b] of [[0.2, 1.4], [1.9, 2.6], [3.6, 5.2], [6.4, 7.6]]) {
      for (let i = Math.round(a * sr); i < Math.min(x.length, Math.round(b * sr)); i++) {
        const t = i / sr;
        const f0 = 150 + 20 * Math.sin(2 * Math.PI * 5 * t);
        let s = 0;
        for (let h = 1; h <= 8; h++) s += Math.sin(2 * Math.PI * f0 * h * t) / h;
        x[i] = 0.18 * (0.5 + 0.5 * Math.sin(2 * Math.PI * 4 * (t - a))) * s;
      }
    }
    for (let i = 0; i < x.length; i++) x[i] += noise * (r() * 2 - 1);
    return [x, x.map((v) => v * 0.9)];
  }
  function guitar(sr: number, seconds: number): Signal {
    const x = new Float32Array(sr * seconds);
    const chords = [[196, 247, 294], [220, 277, 330], [175, 220, 262], [196, 247, 294]];
    const len = x.length / chords.length;
    chords.forEach((notes, c) => {
      for (let i = 0; i < len; i++) {
        const t = i / sr;
        let s = 0;
        for (const f of notes) s += Math.sin(2 * Math.PI * f * t) + 0.3 * Math.sin(4 * Math.PI * f * t);
        x[Math.round(c * len) + i] = 0.12 * Math.exp(-t / 0.6) * s;
      }
    });
    return [x, x.map((v) => v * 0.95)];
  }
  function drumLoop(sr: number, seconds: number): Signal {
    const r = rng(7);
    const x = new Float32Array(sr * seconds);
    const beat = 60 / 110;
    for (let k = 0; k * beat < seconds; k++) {
      const s0 = Math.round(k * beat * sr);
      for (let i = 0; i < sr * 0.4 && s0 + i < x.length; i++) {
        const t = i / sr;
        x[s0 + i] += k % 2
          ? 0.5 * Math.exp(-t / 0.08) * ((r() * 2 - 1) * 0.7 + 0.3 * Math.sin(2 * Math.PI * 190 * t))
          : 0.8 * Math.exp(-t / 0.12) * Math.sin(2 * Math.PI * (50 + 80 * Math.exp(-t / 0.03)) * t);
      }
    }
    return [x, x.map((v) => v * 0.85)];
  }

  // ------------------------------------------------------------------ cenários
  const drumTweaks: DrumTweaks = {
    samples: { kick: first("kick"), snare: first("snare"), tom1: first("tom"), tom2: first("tom"), floor: first("floor"), rimshot: "synth" },
    kick: 0, snare: 0, toms: 0, floor: 0, kick_tune: 0, snare_tune: 0, toms_tune: 0, floor_tune: 0,
    rimshot: 0, room: 40, sample_mix: 75, reverb_size: "medium", reverb: 25, kick_sens: 50, snare_sens: 50, tom_sens: 50,
  };

  type Scenario = { input: (sr: number) => Signal; sr: number; state: Partial<ExportState> & Pick<ExportState, "chainParts" | "preset"> };
  const withIR = () => {
    const d = clone(CHAINS["guitarra-amp-rock"]);
    d.chain[0].params = { ...d.chain[0].params, ir: guitarIR.id };
    return d;
  };
  const SCENARIOS: Record<string, Scenario> = {
    "voz-com-ruido": {
      input: (sr) => voice(sr, 8, 0.01), sr: 48000,
      state: { preset: { slug: "criador-youtuber" }, chainParts: { base: clone(CHAINS["criador-youtuber"]), drums: null, reverb: null, master: null }, denoise: 0.9, social: true },
    },
    "guitarra-amp-caixa": {
      input: (sr) => guitar(sr, 6), sr: 48000,
      state: { preset: { slug: "guitarra-amp-rock" }, chainParts: { base: withIR(), drums: null, reverb: null, master: null }, social: true },
    },
    "bateria-com-reforco": {
      input: (sr) => drumLoop(sr, 6), sr: 48000,
      state: { preset: { slug: "bateria-pop-rock" }, chainParts: { base: clone(CHAINS["bateria-pop-rock"]), drums: drumTweaks, reverb: null, master: null }, social: true },
    },
    // mesma bateria com áudio a 44,1 kHz: os samples (48 kHz) precisam ser reamostrados
    "bateria-44k1": {
      input: (sr) => drumLoop(sr, 6), sr: 44100,
      state: { preset: { slug: "bateria-pop-rock" }, chainParts: { base: clone(CHAINS["bateria-pop-rock"]), drums: drumTweaks, reverb: null, master: null }, social: true },
    },
    "voz-cortes-e-wav": {
      input: (sr) => voice(sr, 8, 0.002), sr: 48000,
      state: {
        preset: { slug: "criador-youtuber" }, chainParts: { base: clone(CHAINS["criador-youtuber"]), drums: null, reverb: null, master: null },
        social: true, cutting: true, cutLevel: "suave", segments: [{ start: 0, end: 1.6 }, { start: 1.8, end: 2.8 }, { start: 3.4, end: 8 }],
      },
    },
  };

  function stateFor(s: Scenario, channels: Signal): ExportState {
    const duration = channels[0].length / s.sr;
    return {
      target: "wav",
      media: { file: { name: "entrada.wav", size: channels[0].length * 8, lastModified: 0 }, kind: "audio", videoContainer: "mp4", sampleRate: s.sr, channels, audioStart: 0, duration },
      customizing: false, intensity: 75, denoise: 0, social: false,
      cutLevel: "off", segments: [{ start: 0, end: duration }], cutting: false,
      look: { format: "original", fit: "blur", watermark: false, captions: null, fontFamily: "Arial", color: null, cta: null },
      comparing: false, audiogram: null, music: null,
      library: { drums: drums.map((d) => ({ id: d.id, files: d.files, room_files: d.room_files })), irs: irs.map((i) => ({ id: i.id, file: i.file })) },
      buildId: "paridade",
      ...s.state,
    } as ExportState;
  }

  const sha = (x: Signal) => {
    const h = createHash("sha256");
    for (const ch of x) h.update(Buffer.from(ch.buffer, ch.byteOffset, ch.byteLength));
    return h.digest("hex");
  };
  function seeded(seed: number) {
    return () => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /** (a) o caminho do app, em processo, com o job em memória (sem passar por JSON). */
  async function pathA(job: ExportJob, input: Signal, sr: number) {
    const assets = await loadJobAssets(job, sr, { storageUrl: URL_, cacheDir: CACHE });
    const p = await processAudio(input.map((c) => c.slice()), sr, {
      chain: job.audio.chain, intensity: job.audio.intensity, social: job.audio.social.enabled, denoise: job.audio.denoise,
      preroll: 0, drumSamples: assets.drumSamples, impulses: assets.impulses,
    });
    const out = job.cuts.applied ? spliceAudio(p.channels, sr, job.source.audio_start_s, job.cuts.segments) : p.channels;
    const random = Math.random;
    Math.random = seeded(SEED);
    const blob = (await exportAudio({ file: new File([], "a.wav"), sampleRate: sr } as unknown as LoadedMedia, out, "wav", () => {})).blob;
    Math.random = random;
    const file = new Uint8Array(await blob.arrayBuffer());
    return { out, approximate: assets.approximate, file };
  }

  const tsxCli = createRequire(resolve("../../packages/contracts/package.json")).resolve("tsx/cli");
  const rows: string[] = [];
  let failures = 0;
  for (const [name, s] of Object.entries(SCENARIOS)) {
    const dir = join(OUT, name);
    mkdirSync(dir, { recursive: true });
    const input = s.input(s.sr);
    const job = buildExportJob(stateFor(s, input));
    writeFileSync(join(dir, "job.json"), JSON.stringify(job, null, 1));
    writeFileSync(join(dir, "entrada.wav"), encodeWavFloat(input, s.sr));

    const a = await pathA(job, input, s.sr);
    const b = spawnSync(process.execPath, [tsxCli, "scripts/run-export-job.ts", "--job", join(dir, "job.json"), "--in", join(dir, "entrada.wav"),
      "--out", join(dir, "saida-b.wav"), "--seed", String(SEED), "--cache", CACHE, "--storage-url", URL_, "--float-out", join(dir, "saida-b.f32")], { encoding: "utf8" });
    if (b.status !== 0) throw new Error(`${name}: script falhou\n${b.stderr}`);
    const rb = JSON.parse(b.stdout);

    // comparação: impressão digital exata; se não bater, a maior diferença por amostra
    const fileA = createHash("sha256").update(a.file).digest("hex");
    const exact = sha(a.out) === rb.sha256_f32;
    let maxDiff = 0;
    if (!exact) {
      const raw = readFileSync(join(dir, "saida-b.f32"));
      const fb = new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4);
      const n = a.out[0].length;
      for (let i = 0; i < n; i++) for (let c = 0; c < a.out.length; c++) maxDiff = Math.max(maxDiff, Math.abs(a.out[c][i] - fb[i * a.out.length + c]));
    }
    const la = integratedLoudness(a.out, s.sr);
    const pa = samplePeak(a.out);
    const tol = a.out[0].length === rb.amostras && Math.abs(la - rb.lufs) <= 1e-5 && Math.abs(pa - rb.pico) <= 1e-6 * Math.max(pa, rb.pico) + 1e-9;
    if (!exact && !tol) failures++;
    rows.push(
      [name, `${s.sr / 1000} kHz`, String(a.out[0].length), la.toFixed(4), pa.toFixed(6), exact ? "igual" : "DIFERENTE", fileA === rb.sha256_arquivo ? "igual" : "DIFERENTE",
        exact ? "-" : maxDiff.toExponential(2), tol ? "ok" : "FORA", a.approximate ? "sim" : "não", job.audio.assets.drum_samples.filter((d) => !d.builtin).length + job.audio.assets.irs.filter((i) => !i.builtin).length + ""].join(" | "),
    );
  }
  console.log("cenário | taxa | amostras | LUFS | pico | float (exato) | WAV c/ dither fixo | maior dif. | tolerância | reamostrado | assets do Storage");
  console.log(rows.join("\n"));
  process.exit(failures ? 1 : 0);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
