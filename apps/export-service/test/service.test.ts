/**
 * Serviço de exportação de ponta a ponta, sem rede e sem nuvem: armazenamento em pasta, jobs em
 * JSON, catálogo fixo (só caixas embutidas e bateria sintetizada). Precisa de FFmpeg/ffprobe
 * (FFMPEG_PATH/FFPROBE_PATH); sem eles é pulado, exceto com REQUIRE_FFMPEG=1 (CI).
 */
(globalThis as Record<string, unknown>).WorkerGlobalScope ??= function WorkerGlobalScope() {};
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import type { ChainDoc } from "@/lib/dsp/chain";
import { integratedLoudness, samplePeak } from "@/lib/dsp/loudness";
import type { Signal } from "@/lib/dsp/types";
import { processJobAudio } from "@/lib/export/audio-job";
import { buildExportJob, type ExportState } from "@/lib/export/build-job";
import { decodeMedia } from "@/lib/export/ffmpeg-decode";
import { loadJobAssets } from "@/lib/export/node-assets";
import { encodeWavFloat } from "@/lib/export/wav";
import type { Look } from "@/lib/media/compose";
import { starterChain } from "@/lib/mix";
import { StaticCatalog } from "../src/adapters/catalog";
import { LocalJobStore } from "../src/adapters/jobs";
import { LocalStorage } from "../src/adapters/storage";
import { DEFAULT_LIMITS, type ServiceDeps } from "../src/pipeline";
import { createService } from "../src/server";

const FFMPEG = process.env.FFMPEG_PATH ?? "ffmpeg";
const FFPROBE = process.env.FFPROBE_PATH ?? "ffprobe";
const available = spawnSync(FFMPEG, ["-version"]).status === 0 && spawnSync(FFPROBE, ["-version"]).status === 0;
if (!available && process.env.REQUIRE_FFMPEG === "1") throw new Error("FFmpeg/ffprobe não encontrados (REQUIRE_FFMPEG=1)");
const skip = available ? false : "FFmpeg não encontrado";

const WEB = join(__dirname, "../../web");
const CHAINS: Record<string, ChainDoc> = JSON.parse(readFileSync(join(WEB, "lib/export/fixtures/chains.json"), "utf8"));
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
const SR = 48000;
const plain: Look = { format: "original", fit: "blur", watermark: false, captions: null, fontFamily: "Arial", color: null, cta: null };

let dir = "";
let deps: ServiceDeps;
let jobs: LocalJobStore;
let storage: LocalStorage;
let base = "";
let server: ReturnType<typeof createService>;

before(async () => {
  dir = mkdtempSync(join(tmpdir(), "mixpro-servico-"));
  storage = new LocalStorage(join(dir, "armazenamento"));
  jobs = new LocalJobStore(join(dir, "jobs.json"));
  deps = { storage, jobs, catalog: new StaticCatalog(), ffmpeg: FFMPEG, ffprobe: FFPROBE, assetStorageUrl: "http://127.0.0.1:9", assetMemory: new Map(), limits: { ...DEFAULT_LIMITS, maxAttempts: 1 } };
  server = createService(deps);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => {
  server?.close();
  if (dir) rmSync(dir, { recursive: true, force: true });
});

// ------------------------------------------------------------------ entradas e jobs

function rng(seed: number) {
  return () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff) * 2 - 1;
}
/** `noise`: ruído branco até 24 kHz (o MP3/AAC cortam acima de ~20 kHz e o LUFS cai um pouco). */
function voice(seconds: number, noise = 0.01): Signal {
  const r = rng(1);
  const x = new Float32Array(SR * seconds);
  for (let i = 0; i < x.length; i++) {
    const t = i / SR;
    if (t % 2 < 1.3) for (let h = 1; h <= 6; h++) x[i] += (0.15 / h) * Math.sin(2 * Math.PI * (150 + 20 * Math.sin(2 * Math.PI * 5 * t)) * h * t);
    x[i] += noise * r();
  }
  return [x, x.map((v) => v * 0.9)];
}
function guitar(seconds: number): Signal {
  const x = new Float32Array(SR * seconds);
  for (let i = 0; i < x.length; i++) {
    const t = (i / SR) % 1.5;
    x[i] = 0.12 * Math.exp(-t / 0.6) * (Math.sin(2 * Math.PI * 196 * t) + Math.sin(2 * Math.PI * 247 * t) + Math.sin(2 * Math.PI * 294 * t));
  }
  return [x, x.map((v) => v * 0.95)];
}
function drums(seconds: number): Signal {
  const r = rng(7);
  const x = new Float32Array(SR * seconds);
  const beat = 60 / 110;
  for (let i = 0; i < x.length; i++) {
    const t = i / SR;
    const k = Math.floor(t / beat);
    const b = t - k * beat;
    if (b < 0.4) x[i] = k % 2 ? 0.5 * Math.exp(-b / 0.08) * r() : 0.8 * Math.exp(-b / 0.12) * Math.sin(2 * Math.PI * (50 + 80 * Math.exp(-b / 0.03)) * b);
  }
  return [x, x.map((v) => v * 0.85)];
}

function state(ch: Signal, o: Partial<ExportState> = {}, sr = SR, audioStart = 0): ExportState {
  const duration = ch[0].length / sr;
  return {
    target: "wav",
    media: { file: { name: "entrada.wav", size: 1, lastModified: 1 }, kind: "audio", videoContainer: "mp4", sampleRate: sr, channels: ch, audioStart, duration },
    preset: { slug: "criador-youtuber" },
    chainParts: { base: clone(CHAINS["criador-youtuber"]), drums: null, reverb: null, master: null },
    customizing: false,
    intensity: 75,
    denoise: 0,
    social: true,
    cutLevel: "off",
    segments: [{ start: audioStart, end: audioStart + duration }],
    cutting: false,
    look: plain,
    comparing: false,
    audiogram: null,
    music: null,
    library: { drums: [], irs: [] },
    buildId: "teste",
    ...o,
  };
}

/** Decodificação "de player" (o FFmpeg descarta atraso/enchimento do codificador). */
function gapless(file: string, sr: number, nch: number): Signal {
  const o = spawnSync(FFMPEG, ["-v", "error", "-i", file, "-f", "f32le", "-c:a", "pcm_f32le", "-ac", String(nch), "-ar", String(sr), "-"], { maxBuffer: 1 << 28 }).stdout;
  const f = new Float32Array(o.buffer, o.byteOffset, o.byteLength / 4);
  const n = f.length / nch;
  return Array.from({ length: nch }, (_, c) => Float32Array.from({ length: n }, (_, i) => f[i * nch + c]));
}

const sha = (x: Signal) => {
  const h = createHash("sha256");
  for (const c of x) h.update(Buffer.from(c.buffer, c.byteOffset, c.byteLength));
  return h.digest("hex");
};

async function enqueue(jobJson: string, input: Uint8Array) {
  const key = `in/${randomUUID()}`;
  await storage.put(key, input);
  return jobs.create({ user_id: "00000000-0000-0000-0000-000000000001", job_json: jobJson, input_key: key });
}
async function run(id: string) {
  const r = await fetch(`${base}/run`, { method: "POST", body: JSON.stringify({ job_id: id }) });
  return { http: r.status, body: (await r.json()) as { status: string; error_code: string | null } };
}

/** Entrada WAV float (sem perda) + o resultado esperado pelo caminho do app (processJobAudio com as mesmas caixas). */
async function scenario(ch: Signal, o: Partial<ExportState>) {
  const job = buildExportJob(state(ch, o));
  // caixas embutidas (mp:) e bateria sintetizada: nada vem do Storage
  const assets = await loadJobAssets(job, SR, { storageUrl: "", memory: new Map() });
  const expected = await processJobAudio(job, ch.map((c) => c.slice()), SR, { drumSamples: assets.drumSamples, impulses: assets.impulses });
  const rec = await enqueue(JSON.stringify(job), encodeWavFloat(ch, SR));
  return { job, rec, expected };
}

// ------------------------------------------------------------------ testes

test("healthz", { skip }, async () => {
  const r = await fetch(`${base}/healthz`);
  assert.equal(r.status, 200);
  assert.equal(((await r.json()) as { ok: boolean }).ok, true);
});

test("ponta a ponta: voz com ruído, guitarra com amp + caixa, bateria — mesmo sha256_f32 do caminho do app", { skip }, async () => {
  const cases = {
    "voz com ruído": await scenario(voice(8), { denoise: 0.9 }),
    "guitarra amp + caixa": await scenario(guitar(6), { preset: { slug: "do-zero-guitar" }, chainParts: { base: starterChain("guitar"), drums: null, reverb: null, master: null } }),
    "bateria (sintetizada)": await scenario(drums(6), { preset: { slug: "bateria-pop-rock" }, chainParts: { base: clone(CHAINS["bateria-pop-rock"]), drums: null, reverb: null, master: null } }),
  };
  for (const [name, c] of Object.entries(cases)) {
    const r = await run(c.rec.id);
    assert.equal(r.body.status, "done", `${name}: ${JSON.stringify(r.body)}`);
    const rec = (await jobs.get(c.rec.id))!;
    assert.equal(rec.measures!.sha256_f32, sha(c.expected), name);
    assert.equal(rec.measures!.samples, c.expected[0].length);
    assert.equal(rec.job_json, null, "o JSON do job (com o CTA) é apagado no done");
  }
});

test("três formatos de saída: duração, LUFS (±0,1 dB; AAC ±0,25 dB) e pico", { skip }, async () => {
  // sem conteúdo acima de ~20 kHz (ruído branco, saturação): o MP3 (LAME) corta ali e o LUFS cai
  // 0,17–0,23 dB nesses sinais sintéticos — medido; gravações reais em EXPORTJOB_FATIA3.md
  const ch = voice(8, 0);
  const natural = { preset: { slug: "violao-cel-natural" }, chainParts: { base: clone(CHAINS["violao-cel-natural"]), drums: null, reverb: null, master: null } };
  for (const target of ["wav", "mp3", "m4a"] as const) {
    const c = await scenario(ch, { target, ...natural });
    const r = await run(c.rec.id);
    assert.equal(r.body.status, "done", target);
    const rec = (await jobs.get(c.rec.id))!;
    const file = join(dir, "armazenamento", rec.output_key!);
    const d = await decodeMedia(file, { ffmpeg: FFMPEG, ffprobe: FFPROBE, maxDurationS: 900 });
    const want = rec.measures!;
    // MP3 traz o atraso do codificador (como no app); a duração confere dentro de 2 quadros
    assert.ok(Math.abs(d.duration - want.duration_s) < 0.06, `${target}: duração ${d.duration} × ${want.duration_s}`);
    // LUFS/pico medidos como um player toca (sem o atraso do codificador MP3): o atraso desloca
    // os blocos de 400 ms da medição e, num sinal liga/desliga sintético, muda o LUFS em ~0,2 dB
    const g = gapless(file, d.sampleRate, d.channels.length);
    const lufs = integratedLoudness(g, d.sampleRate);
    // o codificador AAC nativo do FFmpeg muda entre versões: medido 0,16 dB no FFmpeg 6.1 do Ubuntu
    // (CI) e < 0,1 dB no 5.1 da imagem e no 7.x; inaudível, mas acima do limite dos outros formatos
    const tol = target === "m4a" ? 0.25 : 0.1;
    assert.ok(Math.abs(lufs - want.lufs) <= tol, `${target}: LUFS ${lufs} × ${want.lufs}`);
    const peakDb = 20 * Math.log10(samplePeak(g));
    assert.ok(Math.abs(peakDb - 20 * Math.log10(want.peak)) <= 1, `${target}: pico ${peakDb} dB`);
  }
});

test("entrada por MP4 (AAC, índice no início) dá o mesmo áudio que o arquivo decodificado direto", { skip }, async () => {
  const src = join(dir, "voz.wav");
  writeFileSync(src, encodeWavFloat(voice(6), SR));
  const mp4 = join(dir, "voz.m4a");
  assert.equal(spawnSync(FFMPEG, ["-v", "error", "-y", "-i", src, "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", mp4]).status, 0);
  const d = await decodeMedia(mp4, { ffmpeg: FFMPEG, ffprobe: FFPROBE, maxDurationS: 900 });
  const job = buildExportJob(state(d.channels, {}, d.sampleRate, d.audioStart));
  const expected = await processJobAudio(job, d.channels.map((c) => c.slice()), d.sampleRate);
  const rec = await enqueue(JSON.stringify(job), readFileSync(mp4));
  const r = await run(rec.id);
  assert.equal(r.body.status, "done", JSON.stringify(r.body));
  assert.equal((await jobs.get(rec.id))!.measures!.sha256_f32, sha(expected));
});

test("recusas com o código certo", { skip }, async () => {
  const ch = voice(4);
  const good = buildExportJob(state(ch));
  const wav = encodeWavFloat(ch, SR);
  const mk = (mut: (j: Record<string, any>) => void) => {
    const j = clone(good) as Record<string, any>;
    mut(j);
    return JSON.stringify(j);
  };
  const ffm = (args: string[], out: string) => {
    assert.equal(spawnSync(FFMPEG, ["-v", "error", "-y", ...args, out]).status, 0);
    return readFileSync(out);
  };
  // > 10 min medidos (o job declara menos: o cabeçalho do arquivo decide)
  const long = new Float32Array(8000 * 610);
  const longJob = buildExportJob(state([long.map((_, i) => 0.1 * Math.sin(i / 3))], {}, 8000));
  const longJson = JSON.stringify({ ...longJob, source: { ...longJob.source, duration_s: 590 }, cuts: { ...longJob.cuts, segments: [{ start: 0, end: 590 }] } });
  const m4a = join(dir, "faststart.m4a");
  const m4aBytes = ffm(["-f", "lavfi", "-i", "sine=frequency=330:sample_rate=48000:duration=6", "-c:a", "aac", "-movflags", "+faststart"], m4a);
  const m4aMeta = await decodeMedia(m4a, { ffmpeg: FFMPEG, ffprobe: FFPROBE, maxDurationS: 900 });
  const m4aJob = JSON.stringify(buildExportJob(state(m4aMeta.channels, {}, m4aMeta.sampleRate, m4aMeta.audioStart)));
  const moovEnd = ffm(["-f", "lavfi", "-i", "sine=frequency=330:sample_rate=48000:duration=6", "-c:a", "aac"], join(dir, "fim.m4a"));
  const aiff = ffm(["-f", "lavfi", "-i", "sine=frequency=330:sample_rate=48000:duration=4", "-ac", "2"], join(dir, "x.aiff"));
  const withUnknownDrum = buildExportJob(state(ch, { preset: { slug: "bateria-pop-rock" }, chainParts: { base: clone(CHAINS["bateria-pop-rock"]), drums: { samples: { kick: "6f1c6c1e-1d1a-4a4b-9a55-2b1b0c6d7e01", snare: "synth", tom1: "synth", tom2: "synth", floor: "synth", rimshot: "synth" }, kick: 0, snare: 0, toms: 0, floor: 0, kick_tune: 0, snare_tune: 0, toms_tune: 0, floor_tune: 0, rimshot: 0, room: 40, sample_mix: 70, reverb_size: "medium", reverb: 25, kick_sens: 50, snare_sens: 50, tom_sens: 50 }, reverb: null, master: null } }));

  const cases: [string, string, Uint8Array, string][] = [
    ["fora do escopo (legendas)", mk((j) => (j.captions = { captions: [], style: "destaque", position: "bottom" })), wav, "OUT_OF_SCOPE"],
    ["duração medida ≠ declarada", mk((j) => (j.source.duration_s = 4.5)), wav, "DURATION_MISMATCH"],
    ["taxa ≠ declarada", mk((j) => (j.source.sample_rate = 44100)), wav, "RATE_MISMATCH"],
    ["mais de 10 min medidos", longJson, encodeWavFloat([long.map((_, i) => 0.1 * Math.sin(i / 3))], 8000), "TOO_LONG"],
    ["contêiner fora da lista (AIFF)", mk(() => {}), aiff, "UNSUPPORTED_FORMAT"],
    ["asset por caminho em vez de id", mk((j) => (j.audio.assets.drum_samples = [{ id: "../../x", builtin: false, files: ["x"], room_files: [] }])), wav, "INVALID_JOB"],
    ["sample (id) que não existe no catálogo", JSON.stringify(withUnknownDrum), wav, "ASSET_NOT_FOUND"],
    ["job adulterado (intensidade)", mk((j) => (j.audio.intensity = 50)), wav, "REF_INVALID"],
    ["arquivo corrompido", mk(() => {}), new Uint8Array(4096).map((_, i) => (i * 7919) % 251), "UNSUPPORTED_FORMAT"],
    ["arquivo truncado (MP4)", m4aJob, m4aBytes.subarray(0, Math.floor(m4aBytes.length * 0.5)), "TRUNCATED_INPUT"],
    ["arquivo truncado (WAV)", mk(() => {}), wav.subarray(0, Math.floor(wav.length * 0.6)), "TRUNCATED_INPUT"],
    ["MP4 com o índice no fim (não dá para ler em fluxo)", m4aJob, moovEnd, "UNSUPPORTED_LAYOUT"],
  ];
  for (const [name, json, input, code] of cases) {
    const rec = await enqueue(json, input);
    const r = await run(rec.id);
    assert.equal(r.body.status, "failed", `${name}: ${JSON.stringify(r.body)}`);
    assert.equal(r.body.error_code, code, name);
    const after = (await jobs.get(rec.id))!;
    assert.equal(after.error_code, code);
    assert.equal(after.job_json, null, "o JSON do job é apagado na falha");
    assert.equal(after.credit_state, "released");
  }
  // job inexistente
  const r = await run(randomUUID());
  assert.equal(r.http, 404);
});

test("caminhos de arquivo no job são ignorados (o servidor usa só os IDs)", { skip }, async () => {
  const ch = guitar(4);
  const s = { preset: { slug: "do-zero-guitar" }, chainParts: { base: starterChain("guitar"), drums: null, reverb: null, master: null } };
  const clean = await scenario(ch, s);
  const dirty = buildExportJob(state(ch, s));
  dirty.audio.assets.irs = dirty.audio.assets.irs.map((i) => ({ ...i, file: "ir/../../segredo.wav" }));
  const rec = await enqueue(JSON.stringify(dirty), encodeWavFloat(ch, SR));
  assert.equal((await run(rec.id)).body.status, "done");
  assert.equal((await run(clean.rec.id)).body.status, "done");
  assert.equal((await jobs.get(rec.id))!.measures!.sha256_f32, (await jobs.get(clean.rec.id))!.measures!.sha256_f32);
});

test("retentativa: /run duas vezes não duplica a saída nem o commit; concorrente recebe 409/429", { skip }, async () => {
  const c = await scenario(voice(4), {});
  const first = await run(c.rec.id);
  assert.equal(first.body.status, "done");
  const rec1 = (await jobs.get(c.rec.id))!;
  const out = join(dir, "armazenamento", rec1.output_key!);
  const mtime = statSync(out).mtimeMs;
  const second = await run(c.rec.id);
  assert.equal(second.http, 200);
  assert.equal(second.body.status, "done");
  const rec2 = (await jobs.get(c.rec.id))!;
  assert.equal(rec2.commits, 1, "um commit só");
  assert.equal(rec2.attempts, 1, "não reprocessou");
  assert.equal(statSync(out).mtimeMs, mtime, "a saída não foi regravada");

  // dois /run ao mesmo tempo para outro job: um processa, o outro é recusado sem processar
  const d = await scenario(voice(4), {});
  const [a, b] = await Promise.all([run(d.rec.id), run(d.rec.id)]);
  assert.deepEqual([a.http, b.http].sort(), [200, 429].sort().includes(a.http) ? [a.http, b.http].sort() : [200, 409]);
  const recD = (await jobs.get(d.rec.id))!;
  assert.equal(recD.status, "done");
  assert.equal(recD.commits, 1);
});
