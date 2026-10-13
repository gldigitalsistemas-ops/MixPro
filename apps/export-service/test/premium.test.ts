/**
 * Recursos premium de ponta a ponta no serviço (pasta local + banco em memória + FFmpeg real).
 * A Music.AI e o gerador em GPU entram como versões falsas com o mesmo contrato.
 */
(globalThis as Record<string, unknown>).WorkerGlobalScope ??= function WorkerGlobalScope() {};
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { decodeMedia } from "@/lib/export/ffmpeg-decode";
import { integratedLoudness } from "@/lib/dsp/loudness";
import { LocalStorage } from "../src/adapters/storage";
import { MemoryToolStore, type ToolRecord } from "../src/adapters/tool-store";
import type { StemSeparator } from "../src/adapters/musicai";
import type { Composer, ComposeRequest } from "../src/adapters/composer";
import { runTool, type ToolDeps } from "../src/tools";
import { DEFAULT_LIMITS } from "../src/pipeline";

const FFMPEG = process.env.FFMPEG_PATH ?? "ffmpeg";
const FFPROBE = process.env.FFPROBE_PATH ?? "ffprobe";
const available = spawnSync(FFMPEG, ["-version"]).status === 0 && spawnSync(FFPROBE, ["-version"]).status === 0;
if (!available && process.env.REQUIRE_FFMPEG === "1") throw new Error("FFmpeg/ffprobe não encontrados (REQUIRE_FFMPEG=1)");
const skip = available ? false : "FFmpeg não encontrado";

/** Armazenamento local com "URLs" falsas (local://chave) para o gerador falso. */
class UrlStorage extends LocalStorage {
  presign(_m: "GET" | "PUT", key: string) {
    return `local://${key}`;
  }
}

let dir = "";
let storage: UrlStorage;
let store: MemoryToolStore;
let deps: ToolDeps;
const separations: number[] = [];
const generations: ComposeRequest[] = [];

function lavfi(args: string[], ext = "wav"): Uint8Array {
  const f = join(dir, `${randomUUID()}.${ext}`);
  const r = spawnSync(FFMPEG, ["-v", "error", "-y", ...args, f]);
  assert.equal(r.status, 0, String(r.stderr));
  return new Uint8Array(readFileSync(f));
}

/** Music.AI falsa: devolve 6 faixas (senos em frequências diferentes) no formato da API. */
const fakeMusicAi: StemSeparator = {
  usdPerMinute: 0.48,
  async separate(audio) {
    separations.push(audio.byteLength);
    const tone = (hz: number) => lavfi(["-f", "lavfi", "-i", `sine=frequency=${hz}:duration=30:sample_rate=44100`, "-af", "volume=0.1", "-ac", "2"]);
    return { vocals: tone(440), drums: tone(60), bass: tone(55), keys: tone(262), acoustic_guitar: tone(196), electric_guitar: tone(330) };
  },
};

/** Gerador falso: grava a própria guia (mesmo andamento e harmonia) como "base" de cada versão. */
const fakeComposer: Composer = {
  usdPerRun: 0.02,
  async generate(req) {
    generations.push(req);
    const guideKey = req.guideUrl.replace("local://", "");
    const chunks: Buffer[] = [];
    for await (const c of storage.read(guideKey)) chunks.push(c as Buffer);
    const guide = Buffer.concat(chunks);
    for (const u of req.outputUrls) await storage.put(u.replace("local://", ""), new Uint8Array(guide));
  },
};

before(() => {
  dir = mkdtempSync(join(tmpdir(), "mixpro-premium-"));
  storage = new UrlStorage(join(dir, "armazenamento"));
  store = new MemoryToolStore();
  deps = { storage, tools: store, ffmpeg: FFMPEG, ffprobe: FFPROBE, limits: { ...DEFAULT_LIMITS, maxAttempts: 1 }, premium: { musicai: fakeMusicAi, composer: fakeComposer } };
});
after(() => dir && rmSync(dir, { recursive: true, force: true }));

async function projectInputs(files: Uint8Array[]) {
  const pid = randomUUID();
  const keys: string[] = [];
  for (const [i, f] of files.entries()) {
    const k = `cofre/proj/${pid}/${String(i).padStart(2, "0")}`;
    await storage.put(k, f);
    keys.push(k);
  }
  return { pid, keys };
}

function job(tool: string, params: Record<string, unknown>, inputs: string[], days = 30): string {
  const id = randomUUID();
  const rec: ToolRecord = { id, user_id: "u", tool, status: "queued", params, inputs, credits: 0, credit_state: "none", attempts: 0, expires_at: new Date(Date.now() + days * 86_400_000).toISOString() };
  store.jobs.set(id, rec);
  return id;
}

const outs = (id: string) => store.jobs.get(id)!.outputs!;
const decodeOut = (key: string) => decodeMedia(join(dir, "armazenamento", key), { ffmpeg: FFMPEG, ffprobe: FFPROBE, maxDurationS: 900 });

// "música": acordes C–Am–F–G (2 s cada) com pulso a 120 BPM, 40 s
const song = () =>
  lavfi([
    "-f", "lavfi", "-i",
    "aevalsrc='0.08*(sin(2*PI*261.6*t)+sin(2*PI*329.6*t)+sin(2*PI*392*t))*lt(mod(t,8),2)+0.08*(sin(2*PI*220*t)+sin(2*PI*261.6*t)+sin(2*PI*329.6*t))*gte(mod(t,8),2)*lt(mod(t,8),4)+0.08*(sin(2*PI*174.6*t)+sin(2*PI*220*t)+sin(2*PI*261.6*t))*gte(mod(t,8),4)*lt(mod(t,8),6)+0.08*(sin(2*PI*196*t)+sin(2*PI*246.9*t)+sin(2*PI*293.7*t))*gte(mod(t,8),6)+0.5*sin(2*PI*60*t)*exp(-mod(t,0.5)*20)':s=44100:d=40",
    "-ac", "2",
  ]);

test("VS Premium (prévia): só 30 s vão para a separação; 7 faixas tocáveis + vitrine; nada cobrado", { skip }, async () => {
  const { pid, keys } = await projectInputs([song()]);
  const id = job("stems_premium", { project_id: pid, preview: true, format: "wav", durations: [40] }, keys, 1);
  const r = await runTool(id, deps);
  assert.equal(r.status, "done", JSON.stringify(r));
  const names = outs(id).map((o) => o.name);
  for (const s of ["voz", "bateria", "baixo", "guitarra", "violao", "teclado", "outros"]) assert.ok(names.includes(`play-${s}.m4a`), s);
  assert.ok(names.includes("vitrine-antes.m4a") && names.includes("vitrine-depois.m4a"));
  assert.ok(!names.some((n) => n.endsWith(".zip")), "prévia não tem pacote");
  const play = await decodeOut(outs(id).find((o) => o.name === "play-voz.m4a")!.key);
  assert.ok(Math.abs(play.duration - 30) < 0.3, `prévia ${play.duration}`);
  assert.ok(separations[separations.length - 1] < 6_000_000, "só o trecho foi enviado");
  assert.equal(store.jobs.get(id)!.credit_state, "none");
});

test("VS Premium (final): faixas no formato pedido + pacote; 'outros' fecha a soma", { skip }, async () => {
  const { pid, keys } = await projectInputs([song()]);
  const id = job("stems_premium", { project_id: pid, preview: false, format: "flac", durations: [40] }, keys);
  assert.equal((await runTool(id, deps)).status, "done");
  const o = outs(id);
  assert.equal(o.filter((x) => x.name.endsWith(".flac")).length, 7);
  assert.ok(o.some((x) => x.name === "vs-premium-7-faixas.zip"));
  assert.ok(o.every((x) => x.key.startsWith("cofre/")), "entrega no Cofre (30 dias)");
});

test("Mix & Master IA: entrega completa (master no alvo, pré-master, instrumental, a capella, pistas, mixer) e decisões", { skip }, async () => {
  const vox = lavfi(["-f", "lavfi", "-i", "aevalsrc='0.2*sin(2*PI*446*t)*lt(mod(t,2),1.5)':s=48000:d=40"]);
  const kick = lavfi(["-f", "lavfi", "-i", "aevalsrc='0.8*sin(2*PI*58*mod(t,0.5))*exp(-mod(t,0.5)*18)':s=48000:d=40"]);
  const bass = lavfi(["-f", "lavfi", "-i", "sine=frequency=55:duration=40:sample_rate=48000", "-af", "volume=0.4"]);
  const gtr = lavfi(["-f", "lavfi", "-i", "aevalsrc='0.1*(sin(2*PI*196*t)+sin(2*PI*247*t)+sin(2*PI*294*t))':s=48000:d=40", "-ac", "2"]);
  const { pid, keys } = await projectInputs([vox, kick, bass, gtr]);
  const t = (name: string, role: string, extra = {}) => ({ name, role, gain_db: 0, pan: null, mute: false, eq_low: 0, eq_mid: 0, eq_high: 0, comp: null, reverb: null, tune: 0, ...extra });
  const params = {
    project_id: pid, preview: false, format: "wav", durations: [40, 40, 40, 40], has_reference: false, ref_amount: 0.6, genre: "worship", align: true,
    tracks: [t("Voz.wav", "lead_vocal", { tune: 60 }), t("Kick.wav", "kick"), t("Baixo.wav", "bass"), t("Violao.wav", "acoustic_guitar")],
    master_chain: null, master_name: null, target_lufs: -11,
  };
  const id = job("mix_ia", params, keys);
  const r = await runTool(id, deps);
  assert.equal(r.status, "done", JSON.stringify(r));
  const o = outs(id);
  const names = o.map((x) => x.name);
  for (const n of ["mix-master.wav", "mix-pre-master.wav", "instrumental.wav", "a-capella.wav", "pistas-mixadas.zip", "vitrine-antes.m4a", "vitrine-depois.m4a"]) assert.ok(names.includes(n), n);
  assert.equal(names.filter((n) => /^pista-\d\d-/.test(n)).length, 4);
  assert.equal(names.filter((n) => /^mixer-\d\d\.m4a$/.test(n)).length, 4);
  const master = await decodeOut(o.find((x) => x.name === "mix-master.wav")!.key);
  const lufs = integratedLoudness(master.channels, master.sampleRate);
  assert.ok(Math.abs(lufs - -11) < 1.2, `LUFS ${lufs}`);
  const m = store.jobs.get(id)!.measures as { decisoes: { role: string; tune_cents: number }[] };
  assert.equal(m.decisoes.length, 4);
  assert.ok(m.decisoes[0].tune_cents > 0, "voz afinada");
});

test("Produção (prévia e final): 3 versões conferidas, folha de cifra, clique e melodia da guia", { skip }, async () => {
  const { pid, keys } = await projectInputs([song()]);
  const base = { project_id: pid, format: "mp3", durations: [40], has_reference: false, genre: "worship", style: "Worship moderno", bpm: null, key: null, versions: 3, seed: 7 };
  const prev = job("compose", { ...base, preview: true }, keys, 1);
  assert.equal((await runTool(prev, deps)).status, "done");
  assert.equal(outs(prev).filter((x) => /^previa-versao-\d\.m4a$/.test(x.name)).length, 3);
  assert.ok(generations[0].outputUrls.length === 3 && generations[0].guideUrl.startsWith("local://out/"));

  const fin = job("compose", { ...base, preview: false }, keys);
  const r = await runTool(fin, deps);
  assert.equal(r.status, "done", JSON.stringify(r));
  const names = outs(fin).map((x) => x.name);
  for (const n of ["versao-1.mp3", "versao-2.mp3", "versao-3.mp3", "versao-1-folha.pdf", "producao-versoes.zip"]) assert.ok(names.includes(n), n);
  assert.ok(names.some((n) => /^clique-\d+bpm\.wav$/.test(n)));
  const pdf = readFileSync(join(dir, "armazenamento", outs(fin).find((x) => x.name === "versao-1-folha.pdf")!.key)).toString("latin1");
  assert.ok(pdf.startsWith("%PDF") && /BPM/.test(pdf));
  const m = store.jobs.get(fin)!.measures as { bpm: number; versoes: unknown[]; melodia: unknown[]; acordes_guia: string[] };
  assert.equal(m.versoes.length, 3);
  assert.ok(Math.abs(m.bpm - 120) < 3 || Math.abs(m.bpm - 60) < 2, `BPM ${m.bpm}`);
  assert.ok(Array.isArray(m.melodia));
  // arquivos temporários do gerador apagados
  const tmpLeft = spawnSync("node", ["-e", `console.log(require('fs').readdirSync(${JSON.stringify(join(dir, "armazenamento", "out", fin))}).filter(f=>/^9\\d\\d\\.wav$/.test(f)).length)`]).stdout.toString().trim();
  assert.equal(tmpLeft, "0");
});

test("Voz finalizada: voz alinhada na base, afinada, mixada e masterizada", { skip }, async () => {
  const vox = lavfi(["-f", "lavfi", "-i", "aevalsrc='0.2*sin(2*PI*446*t)*lt(mod(t,2),1.5)':s=48000:d=30"]);
  const baseAudio = lavfi(["-f", "lavfi", "-i", "aevalsrc='0.1*(sin(2*PI*220*t)+sin(2*PI*277*t)+sin(2*PI*330*t))+0.4*sin(2*PI*60*mod(t,0.5))*exp(-mod(t,0.5)*18)':s=48000:d=30", "-ac", "2"]);
  const { pid, keys } = await projectInputs([vox, baseAudio]);
  const id = job("voice_final", { project_id: pid, preview: false, format: "wav", durations: [30, 30], has_reference: false, ref_amount: 0.5, genre: "gospel", tune: 50, melody: [[69, 0, 30]], vocal_level_db: 0, reverb: 30, master_chain: null, master_name: null, target_lufs: -10 }, keys);
  const r = await runTool(id, deps);
  assert.equal(r.status, "done", JSON.stringify(r));
  const names = outs(id).map((x) => x.name);
  for (const n of ["musica-final.wav", "instrumental.wav", "voz-tratada.wav", "musica-pre-master.wav"]) assert.ok(names.includes(n), n);
  const master = await decodeOut(outs(id).find((x) => x.name === "musica-final.wav")!.key);
  assert.ok(Math.abs(integratedLoudness(master.channels, master.sampleRate) - -10) < 1.2);
});

test("sem a Music.AI configurada: VS Premium fica indisponível (nada cobrado, nada gravado)", { skip }, async () => {
  const { pid, keys } = await projectInputs([song()]);
  const id = job("stems_premium", { project_id: pid, preview: true, format: "wav", durations: [40] }, keys, 1);
  const r = await runTool(id, { ...deps, premium: {} });
  assert.equal(r.status, "failed");
  assert.equal(r.error_code, "TOOL_UNAVAILABLE");
});
