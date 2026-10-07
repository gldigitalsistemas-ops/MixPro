/**
 * Ponta a ponta LOCAL do serviço (fatia 3), com rede só para o catálogo e o bucket público:
 *  (a) paridade com o run-export-job.ts (Etapa 3) nos jobs de apps/web/.cache/parity;
 *  (b) os três formatos com uma gravação real (fixtures-local, se existir);
 *  (c) entradas MP4, MOV (cópia da trilha como o aparelho envia), WAV e MP3;
 *  (g) memória: 10 min estéreo com voz + remoção de ruído, num processo separado do serviço.
 *
 * Uso (de apps/export-service; precisa das variáveis públicas do Supabase):
 *   FFMPEG_PATH=... FFPROBE_PATH=... ../../packages/contracts/node_modules/.bin/tsx --env-file=../web/.env.local scripts/e2e-local.ts
 * Saída: tabelas no terminal e .dados/e2e.json. A mídia pessoal (fixtures-local) só é lida aqui.
 */
(globalThis as Record<string, unknown>).WorkerGlobalScope ??= function WorkerGlobalScope() {};
import { spawn, spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import type { AddressInfo } from "node:net";
import { join, resolve } from "node:path";
import type { ChainDoc } from "@/lib/dsp/chain";
import { integratedLoudness, samplePeak } from "@/lib/dsp/loudness";
import type { Signal } from "@/lib/dsp/types";
import { processJobAudio } from "@/lib/export/audio-job";
import { buildExportJob, type ExportState } from "@/lib/export/build-job";
import { decodeMedia } from "@/lib/export/ffmpeg-decode";
import { loadJobAssets } from "@/lib/export/node-assets";
import { RestCatalog } from "../src/adapters/catalog";
import { LocalJobStore } from "../src/adapters/jobs";
import { LocalStorage } from "../src/adapters/storage";
import { DEFAULT_LIMITS, type ServiceDeps } from "../src/pipeline";
import { createService } from "../src/server";

const FFMPEG = process.env.FFMPEG_PATH ?? "ffmpeg";
const FFPROBE = process.env.FFPROBE_PATH ?? "ffprobe";
const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
const HERE = resolve(".");
const WEB = resolve("../web");
const DATA = join(HERE, ".dados/e2e");
const LOCAL = join(WEB, "fixtures-local");
const TSX = createRequire(resolve("../../packages/contracts/package.json")).resolve("tsx/cli");
const CHAINS: Record<string, ChainDoc> = JSON.parse(readFileSync(join(WEB, "lib/export/fixtures/chains.json"), "utf8"));

const sha = (x: Signal) => {
  const h = createHash("sha256");
  for (const c of x) h.update(Buffer.from(c.buffer, c.byteOffset, c.byteLength));
  return h.digest("hex");
};
/** Decodificação "de player" (FFmpeg descarta atraso/enchimento do codificador). */
function gapless(file: string, sr: number, nch: number): Signal {
  const o = spawnSync(FFMPEG, ["-v", "error", "-i", file, "-f", "f32le", "-c:a", "pcm_f32le", "-ac", String(nch), "-ar", String(sr), "-"], { maxBuffer: 1 << 30 }).stdout;
  const f = new Float32Array(o.buffer, o.byteOffset, o.byteLength / 4);
  const n = f.length / nch;
  const out = Array.from({ length: nch }, () => new Float32Array(n));
  for (let i = 0; i < n; i++) for (let c = 0; c < nch; c++) out[c][i] = f[i * nch + c];
  return out;
}
const ffm = (args: string[]) => spawnSync(FFMPEG, ["-v", "error", "-y", ...args]).status === 0;

function state(d: { channels: Signal; sampleRate: number; audioStart: number; duration: number }, o: Partial<ExportState> = {}): ExportState {
  return {
    target: "wav",
    media: { file: { name: "entrada", size: 1, lastModified: 1 }, kind: "audio", videoContainer: "mp4", sampleRate: d.sampleRate, channels: d.channels, audioStart: d.audioStart, duration: d.duration },
    preset: { slug: "criador-youtuber" },
    chainParts: { base: JSON.parse(JSON.stringify(CHAINS["criador-youtuber"])), drums: null, reverb: null, master: null },
    customizing: false,
    intensity: 75,
    denoise: 0.9,
    social: true,
    cutLevel: "off",
    segments: [{ start: d.audioStart, end: d.audioStart + d.duration }],
    cutting: false,
    look: { format: "original", fit: "blur", watermark: false, captions: null, fontFamily: "Arial", color: null, cta: null },
    comparing: false,
    audiogram: null,
    music: null,
    library: { drums: [], irs: [] },
    buildId: "e2e",
    ...o,
  };
}

async function main() {
  if (!URL_ || !KEY) throw new Error("defina NEXT_PUBLIC_SUPABASE_URL e NEXT_PUBLIC_SUPABASE_ANON_KEY (use --env-file=../web/.env.local)");
  rmSync(DATA, { recursive: true, force: true });
  mkdirSync(DATA, { recursive: true });
  const storage = new LocalStorage(join(DATA, "armazenamento"));
  const jobs = new LocalJobStore(join(DATA, "jobs.json"));
  const catalog = new RestCatalog(URL_, KEY);
  const deps: ServiceDeps = { storage, jobs, catalog, ffmpeg: FFMPEG, ffprobe: FFPROBE, assetStorageUrl: URL_, assetMemory: new Map(), limits: DEFAULT_LIMITS };
  const server = createService(deps);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const report: Record<string, unknown> = {};

  async function viaService(jobJson: string, input: Uint8Array, url = base) {
    const key = `in/${randomUUID()}`;
    await storage.put(key, input);
    const rec = await jobs.create({ user_id: "00000000-0000-0000-0000-000000000001", job_json: jobJson, input_key: key });
    const r = await fetch(`${url}/run`, { method: "POST", body: JSON.stringify({ job_id: rec.id }) });
    const body = (await r.json()) as { status: string; error_code: string | null };
    return { body, rec: (await jobs.get(rec.id))! };
  }

  // ---------------------------------------------------------------- (a) paridade com o run-export-job.ts
  console.log("\n(a) serviço × run-export-job.ts (Etapa 3), samples e caixas do Storage");
  console.log("cenário | amostras | LUFS | pico | sha256_f32 serviço = script | assets do Storage");
  const parity: Record<string, unknown>[] = [];
  const pdir = join(WEB, ".cache/parity");
  for (const name of existsSync(pdir) ? readdirSync(pdir) : []) {
    const jobFile = join(pdir, name, "job.json");
    const inFile = join(pdir, name, "entrada.wav");
    if (!existsSync(jobFile) || !existsSync(inFile)) continue;
    const script = spawnSync(process.execPath, [TSX, "scripts/run-export-job.ts", "--job", jobFile, "--in", inFile, "--out", join(DATA, `${name}.wav`), "--cache", join(WEB, ".cache/export-assets"), "--storage-url", URL_], { cwd: WEB, encoding: "utf8", maxBuffer: 1 << 26 });
    if (script.status !== 0) throw new Error(`run-export-job falhou em ${name}`);
    const s = JSON.parse(script.stdout);
    const v = await viaService(readFileSync(jobFile, "utf8"), readFileSync(inFile));
    const m = v.rec.measures;
    const job = JSON.parse(readFileSync(jobFile, "utf8"));
    const storageAssets = job.audio.assets.drum_samples.filter((d: { builtin: boolean }) => !d.builtin).length + job.audio.assets.irs.filter((i: { builtin: boolean }) => !i.builtin).length;
    const same = m?.sha256_f32 === s.sha256_f32;
    parity.push({ name, status: v.body.status, error: v.body.error_code, samples: m?.samples, lufs: m?.lufs, peak: m?.peak, same, storageAssets });
    console.log(`${name} | ${m?.samples ?? "-"} | ${m?.lufs?.toFixed(4) ?? "-"} | ${m?.peak?.toFixed(6) ?? "-"} | ${v.body.status === "done" ? (same ? "IGUAL" : "DIFERENTE") : `FALHOU ${v.body.error_code}`} | ${storageAssets}`);
  }
  report.paridade = parity;

  // ---------------------------------------------------------------- (b) três formatos com gravação real
  const real = join(LOCAL, "Cantando.mp4");
  if (existsSync(real)) {
    console.log("\n(b) três formatos (Cantando.mp4, voz real; LUFS/pico medidos como um player toca)");
    console.log("formato | duração arquivo × áudio | LUFS arquivo × áudio | pico arquivo × áudio (dBFS) | bytes");
    const d = await decodeMedia(real, { ffmpeg: FFMPEG, ffprobe: FFPROBE, maxDurationS: 900 });
    const formats: Record<string, unknown>[] = [];
    for (const target of ["wav", "mp3", "m4a"] as const) {
      const job = buildExportJob(state(d, { target }));
      const v = await viaService(JSON.stringify(job), readFileSync(real));
      const m = v.rec.measures!;
      const file = join(DATA, "armazenamento", v.rec.output_key!);
      const g = gapless(file, m.sample_rate, m.channels);
      const dur = g[0].length / m.sample_rate;
      const lufs = integratedLoudness(g, m.sample_rate);
      const pk = 20 * Math.log10(samplePeak(g));
      formats.push({ target, dur, durAudio: m.duration_s, lufs, lufsAudio: m.lufs, peakDb: pk, peakAudioDb: 20 * Math.log10(m.peak), bytes: m.output_bytes });
      console.log(`${target} | ${dur.toFixed(3)} × ${m.duration_s.toFixed(3)} s | ${lufs.toFixed(3)} × ${m.lufs.toFixed(3)} (Δ ${(lufs - m.lufs).toFixed(3)}) | ${pk.toFixed(2)} × ${(20 * Math.log10(m.peak)).toFixed(2)} | ${m.output_bytes}`);
    }
    report.formatos = formats;
  } else console.log("\n(b) PENDENTE: fixtures-local/Cantando.mp4 não existe");

  // ---------------------------------------------------------------- (c) entradas MP4, MOV (cópia da trilha), WAV, MP3
  console.log("\n(c) entradas: serviço (leitura em fluxo) × caminho do app em processo (mesmo arquivo decodificado)");
  console.log("entrada | formato | resultado | sha256_f32 igual | wall (s)");
  const inputs: [string, string][] = [];
  if (existsSync(real)) inputs.push(["MP4 (AAC, compartilhado)", real]);
  const mov = join(LOCAL, "IMG_7905.MOV");
  if (existsSync(mov)) {
    // como o aparelho enviará: só a trilha de áudio, copiada sem recodificar, com o índice no início
    const copy = join(DATA, "trilha-iphone.m4a");
    if (!ffm(["-i", mov, "-map", "0:a:0", "-vn", "-c:a", "copy", "-movflags", "+faststart", copy])) throw new Error("cópia da trilha falhou");
    const a = await decodeMedia(mov, { ffmpeg: FFMPEG, ffprobe: FFPROBE, maxDurationS: 900 });
    const b = await decodeMedia(copy, { ffmpeg: FFMPEG, ffprobe: FFPROBE, maxDurationS: 900 });
    const same = sha(a.channels) === sha(b.channels) && a.audioStart === b.audioStart;
    console.log(`  cópia da trilha do MOV decodifica igual ao MOV original: ${same ? "SIM" : "NÃO"} (${a.channels[0].length}/${b.channels[0].length} amostras, início ${a.audioStart}/${b.audioStart})`);
    report.copia_trilha_mov = same;
    inputs.push(["MOV do iPhone → trilha M4A", copy]);
  }
  inputs.push(["WAV 16 bits 22,05 kHz mono (projeto)", join(WEB, "lib/dsp/fixtures/bateria-celular-real.wav")]);
  const mp3 = join(LOCAL, "05 Desire.mp3");
  if (existsSync(mp3)) inputs.push(["MP3 CBR", mp3]);
  const inputRows: Record<string, unknown>[] = [];
  for (const [label, file] of inputs) {
    const d = await decodeMedia(file, { ffmpeg: FFMPEG, ffprobe: FFPROBE, maxDurationS: 900 });
    const job = buildExportJob(state(d, { target: "wav", denoise: 0 }));
    const assets = await loadJobAssets(job, d.sampleRate, { storageUrl: URL_, memory: new Map() });
    const expected = sha(await processJobAudio(job, d.channels.map((c) => c.slice()), d.sampleRate, { drumSamples: assets.drumSamples, impulses: assets.impulses }));
    const t = Date.now();
    const v = await viaService(JSON.stringify(job), readFileSync(file));
    const same = v.rec.measures?.sha256_f32 === expected;
    inputRows.push({ label, status: v.body.status, error: v.body.error_code, same, wall: (Date.now() - t) / 1000 });
    console.log(`${label} | ${d.container} / ${d.codec} | ${v.body.status}${v.body.error_code ? ` ${v.body.error_code}` : ""} | ${same ? "IGUAL" : "DIFERENTE"} | ${((Date.now() - t) / 1000).toFixed(1)}`);
  }
  report.entradas = inputRows;
  server.close();

  // ---------------------------------------------------------------- (g) memória: 10 min estéreo, voz + remoção de ruído, processo separado
  console.log("\n(g) memória: 10 min estéreo, voz + remoção de ruído, serviço num processo próprio (tsx src/server.ts)");
  const src = join(WEB, ".cache/bench/voz-10min-2ch.wav");
  if (!existsSync(src)) {
    console.log("PENDENTE: rode antes scripts/bench-export-job.ts (gera .cache/bench/voz-10min-2ch.wav)");
  } else {
    // o aparelho envia a trilha AAC (não WAV): 10 min estéreo a 256 kbps, índice no início
    const aac = join(DATA, "voz-10min-2ch.m4a");
    if (!ffm(["-i", src, "-c:a", "aac", "-b:a", "256k", "-movflags", "+faststart", aac])) throw new Error("AAC de 10 min falhou");
    const d = await decodeMedia(aac, { ffmpeg: FFMPEG, ffprobe: FFPROBE, maxDurationS: 900 });
    const job = buildExportJob(state(d, { target: "m4a", denoise: 0.9 }));
    const port = 18000 + Math.floor(Math.random() * 1000);
    const child = spawn(process.execPath, [TSX, "src/server.ts"], {
      cwd: HERE,
      env: { ...process.env, PORT: String(port), STORAGE_DIR: join(DATA, "armazenamento"), JOBS_FILE: join(DATA, "jobs.json") },
      stdio: ["ignore", "pipe", "inherit"],
    });
    let jobLine = "";
    child.stdout.on("data", (c: Buffer) => {
      for (const l of c.toString("utf8").split("\n")) if (l.includes('"export_job"')) jobLine = l;
    });
    for (let i = 0; i < 100; i++) {
      try {
        if ((await fetch(`http://127.0.0.1:${port}/healthz`)).ok) break;
      } catch {}
      await new Promise((r) => setTimeout(r, 200));
    }
    const v = await viaService(JSON.stringify(job), readFileSync(aac), `http://127.0.0.1:${port}`);
    child.kill();
    const c = v.rec.cost!;
    report.memoria = { status: v.body.status, error: v.body.error_code, ...c, input_bytes: readFileSync(aac).byteLength, log: jobLine };
    console.log(`status ${v.body.status}${v.body.error_code ? ` ${v.body.error_code}` : ""} · pico RSS ${c.rss_mb} MB · CPU ${(c.cpu_ms / 1000).toFixed(1)} s · relógio ${(c.wall_ms / 1000).toFixed(1)} s · etapas ${JSON.stringify(c.etapas_ms)}`);
    console.log(`linha de log do serviço: ${jobLine}`);
  }
  writeFileSync(join(HERE, ".dados/e2e.json"), JSON.stringify(report, null, 1));
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
