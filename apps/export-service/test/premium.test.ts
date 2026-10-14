/**
 * Recursos premium de ponta a ponta no serviço (pasta local + banco em memória + FFmpeg real).
 * A Music.AI e o gerador em GPU entram como versões falsas com o mesmo contrato.
 */
(globalThis as Record<string, unknown>).WorkerGlobalScope ??= function WorkerGlobalScope() {};
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { decodeMedia } from "@/lib/export/ffmpeg-decode";
import { integratedLoudness } from "@/lib/dsp/loudness";
import { LocalStorage } from "../src/adapters/storage";
import { MemoryToolStore, type ToolRecord } from "../src/adapters/tool-store";
import type { StemSeparator } from "../src/adapters/musicai";
import type { Composer, CoverRequest } from "../src/adapters/composer";
import type { LyricsService } from "../src/adapters/lyrics";
import { runTool, type ToolDeps } from "../src/tools";
import { brightness, resolveBpm } from "../src/premium";
import { DEFAULT_LIMITS } from "../src/pipeline";

const LYRICS = ["Santo santo santo", "É o Senhor"].join("\n");
const FFMPEG = process.env.FFMPEG_PATH ?? "ffmpeg";
const FFPROBE = process.env.FFPROBE_PATH ?? "ffprobe";
const available = spawnSync(FFMPEG, ["-version"]).status === 0 && spawnSync(FFPROBE, ["-version"]).status === 0;
if (!available && process.env.REQUIRE_FFMPEG === "1") throw new Error("FFmpeg/ffprobe não encontrados (REQUIRE_FFMPEG=1)");
const skip = available ? false : "FFmpeg não encontrado";

/** Armazenamento local com "URLs" falsas (local://chave) para o gerador falso. */
class UrlStorage extends LocalStorage {
  presign(_m: "GET" | "PUT", key: string, expiresS = 600) {
    // mesma regra do R2 (lib/export/r2.ts): o link vale de 1 s a 1 h
    if (expiresS < 1 || expiresS > 3600) throw new Error("validade da URL deve ficar entre 1 e 3600 s");
    return `local://${key}`;
  }
}

let dir = "";
let storage: UrlStorage;
let store: MemoryToolStore;
let deps: ToolDeps;
const separations: number[] = [];
const generations: CoverRequest[] = [];
const transcriptions: string[] = [];

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

/** Gerador falso: devolve a própria guia (mesmo andamento e harmonia) como a "música" de cada versão. */
const fakeComposer: Composer = {
  usdPerRun: 0.15,
  async cover(req) {
    generations.push(req);
    const chunks: Buffer[] = [];
    for await (const c of storage.read(req.audioUrl.replace("local://", ""))) chunks.push(c as Buffer);
    return new Uint8Array(Buffer.concat(chunks));
  },
};

/** Whisper falso: português, as duas linhas da letra com o tempo de cada palavra. */
const fakeLyrics: LyricsService = {
  async transcribe(url) {
    transcriptions.push(url);
    const words = (t: string, start: number) => t.split(" ").map((w, i) => ({ w, start: start + i * 0.4, end: start + i * 0.4 + 0.3 }));
    return {
      language: "pt",
      probability: 0.97,
      segments: [
        { start: 1, end: 3, text: "Santo santo santo", words: words("Santo santo santo", 1) },
        { start: 5, end: 7, text: "É o Senhor", words: words("É o Senhor", 5) },
      ],
    };
  },
};

before(() => {
  dir = mkdtempSync(join(tmpdir(), "mixpro-premium-"));
  storage = new UrlStorage(join(dir, "armazenamento"));
  store = new MemoryToolStore();
  deps = { storage, tools: store, ffmpeg: FFMPEG, ffprobe: FFPROBE, limits: { ...DEFAULT_LIMITS, maxAttempts: 1 }, premium: { musicai: fakeMusicAi, composer: fakeComposer, lyrics: fakeLyrics } };
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
    "aevalsrc='0.08*(sin(2*PI*261.6*t)+sin(2*PI*329.6*t)+sin(2*PI*392*t))*lt(mod(t,8),2)+0.08*(sin(2*PI*220*t)+sin(2*PI*261.6*t)+sin(2*PI*329.6*t))*gte(mod(t,8),2)*lt(mod(t,8),4)+0.08*(sin(2*PI*174.6*t)+sin(2*PI*220*t)+sin(2*PI*261.6*t))*gte(mod(t,8),4)*lt(mod(t,8),6)+0.08*(sin(2*PI*196*t)+sin(2*PI*246.9*t)+sin(2*PI*293.7*t))*gte(mod(t,8),6)+0.5*sin(2*PI*60*t)*exp(-mod(t,0.5)*20)+0.4*(2*random(0)-1)*exp(-mod(t,0.25)*20)':s=44100:d=40",
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

test("Produção: a prévia gera e guarda as versões; a entrega usa as mesmas (sem gerar de novo): instrumental, mapa, letra e clique em BPM inteiro", { skip }, async () => {
  const { pid, keys } = await projectInputs([song()]);
  const base = { project_id: pid, format: "mp3", durations: [40], has_reference: false, genre: "worship", style: "Worship moderno", lyrics: LYRICS, bpm: null, key: null, versions: 3, seed: 7 };
  const prev = job("compose", { ...base, preview: true }, keys, 1);
  const rp = await runTool(prev, deps);
  assert.equal(rp.status, "done", JSON.stringify(rp));
  assert.equal(outs(prev).filter((x) => /^previa-versao-\d\.m4a$/.test(x.name)).length, 3);
  assert.equal(generations.length, 3, "3 versões geradas");
  const prompt = generations[0].prompt;
  assert.ok(prompt.length <= 300 && /Faithful cover/.test(prompt) && /Brazilian Portuguese/.test(prompt) && /BPM/.test(prompt), prompt);
  assert.ok(generations[0].audioUrl.startsWith("local://out/") && generations[0].audioUrl.endsWith("/990.mp3"), "a guia vai ao gerador por URL temporária (MP3)");
  assert.ok(existsSync(join(dir, "armazenamento", "cofre", "proj", pid, "gen", "meta.json")), "versões guardadas no Cofre do projeto");
  const pm = store.jobs.get(prev)!.measures as { bpm: number; idioma: string; letra: string[] };
  assert.ok(Number.isInteger(pm.bpm), `BPM inteiro: ${pm.bpm}`);
  assert.equal(pm.idioma, "pt");
  assert.deepEqual(pm.letra, ["Santo santo santo", "É o Senhor"]);

  const fin = job("compose", { ...base, preview: false }, keys);
  const r = await runTool(fin, deps);
  assert.equal(r.status, "done", JSON.stringify(r));
  assert.equal(generations.length, 3, "a entrega não gera de novo: usa as versões que a pessoa ouviu");
  const names = outs(fin).map((x) => x.name);
  for (const n of ["versao-1-instrumental.mp3", "versao-2-instrumental.mp3", "versao-3-instrumental.mp3", "versao-1-mapa.pdf", "play-inst-1.m4a", "producao-versoes.zip"]) assert.ok(names.includes(n), n);
  const clickName = names.find((n) => /^versao-1-clique-\d+bpm\.wav$/.test(n));
  assert.ok(clickName, "clique com BPM inteiro no nome");
  const pdf = readFileSync(join(dir, "armazenamento", outs(fin).find((x) => x.name === "versao-1-mapa.pdf")!.key)).toString("latin1");
  assert.ok(pdf.startsWith("%PDF") && /BPM/.test(pdf) && /Santo santo santo/.test(pdf), "mapa com a letra");
  const m = store.jobs.get(fin)!.measures as { bpm: number; versoes: { bpm: number; mapa: { t: number | null; linha: string }[] }[] };
  assert.equal(m.versoes.length, 3);
  for (const v of m.versoes) assert.ok(Number.isInteger(v.bpm), `BPM inteiro: ${v.bpm}`);
  assert.ok(Math.abs(m.bpm - 120) <= 3 || Math.abs(m.bpm - 60) <= 2, `BPM ${m.bpm}`);
  if (names.includes("versao-1-voz-guia.mp3")) {
    // com o modelo de separação instalado: a voz guia é transcrita e a letra ganha os tempos
    assert.ok(names.includes("versao-1-letra.lrc"));
    assert.equal(m.versoes[0].mapa[0].t, 1);
  }
  // a guia temporária (MP3) foi apagada
  const left = spawnSync("node", ["-e", `console.log(require('fs').readdirSync(${JSON.stringify(join(dir, "armazenamento", "out", prev))}).filter(f=>/^990\.mp3$/.test(f)).length)`]).stdout.toString().trim();
  assert.equal(left, "0");
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

test("Produção: andamento da guia na oitava informada; base abafada é recusada", () => {
  // voz cantada a ~116 com "155" no nome do arquivo: vale o medido
  assert.equal(resolveBpm(155, { bpm: 115.4, confidence: 0.5 }), 115);
  assert.equal(resolveBpm(60, { bpm: 115.4, confidence: 0.5 }), 60);
  assert.equal(resolveBpm(null, { bpm: 115.4, confidence: 0.5 }), 115);
  assert.equal(resolveBpm(150, { bpm: 90, confidence: 0.1 }), 150);
  const sr = 44100;
  const dark = new Float32Array(sr * 4).map((_, i) => 0.3 * Math.sin((2 * Math.PI * 80 * i) / sr));
  const bright = dark.map((v) => v + 0.05 * (Math.random() * 2 - 1));
  assert.ok(brightness([dark, dark], sr) < 2000);
  assert.ok(brightness([bright, bright], sr) > 12000);
});
