/**
 * Testes "golden" da exportação: travam a saída atual do processamento de áudio (mesma ordem do
 * dsp.worker: amostras/IRs → remoção de ruído → cadeia → ajuste para redes) e dos cortes, além das
 * funções puras do vídeo. Servem de rede de segurança para refatorações que não podem mudar o som.
 *
 * Regenerar (só quando uma mudança de som for intencional):
 *   UPDATE_GOLDEN=1 ../../packages/contracts/node_modules/.bin/tsx --test lib/export/golden.test.ts
 *
 * fixtures/chains.json = cadeias de presets copiadas das migrações do Supabase (última versão de cada um).
 * Dois níveis por cenário: [exato] = SHA-256 dos bytes float32 (verificação principal) e
 * [tolerância] = amostras, LUFS, pico e RMS por janela (ver `close`), para outro sistema/versão do Node.
 * O RNNoise roda em Node com o mesmo WebAssembly do navegador e é determinístico; não há
 * Math.random/Date em lib/dsp.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { finalizeForSocial, runChain, type ChainDoc } from "@/lib/dsp/chain";
import { integratedLoudness, samplePeak } from "@/lib/dsp/loudness";
import { setDrumSamples } from "@/lib/dsp/drums/studio";
import { setImpulses } from "@/lib/dsp/amp";
import { CABS, synthCabIR } from "@/lib/dsp/cab-ir";
import type { Signal } from "@/lib/dsp/types";
import { speechSegments, spliceAudio, type CutLevel } from "@/lib/media/cuts";
import { needsRender, outputSize, type Look, type VideoFormat } from "@/lib/media/compose";
import { DEFAULT_LOOK, FILTERS, lookIsActive, lookMatrix } from "@/lib/media/color";
import { mixMusic, prepareMusic, safeCeiling, type MusicLevel } from "@/lib/media/music";
import { withMaster } from "@/lib/mix";
import type { StudioPreset } from "@/lib/presets";

// o pacote do RNNoise só carrega "dentro de um worker"; em Node basta simular o ambiente
(globalThis as Record<string, unknown>).WorkerGlobalScope ??= function WorkerGlobalScope() {};

const SR = 48000;
const FIXTURES = fileURLToPath(new URL("./fixtures", import.meta.url));
const GOLDEN_FILE = join(FIXTURES, "golden.json");
const UPDATE = process.env.UPDATE_GOLDEN === "1";
const CHAINS: Record<string, ChainDoc> = JSON.parse(readFileSync(join(FIXTURES, "chains.json"), "utf8"));

// ------------------------------------------------------------------ sinais de entrada (determinísticos)

function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const stereo = (x: Float32Array<ArrayBuffer>, side = 0.9): Signal => [x, x.map((v) => v * side)];

/** Fala sintética: frases com vogais (harmônicos com vibrato) separadas por silêncios, mais chiado. */
function voice(seconds: number, noise: number, seed = 1): Signal {
  const r = rng(seed);
  const n = SR * seconds;
  const x = new Float32Array(n);
  const phrases = [[0.2, 1.4], [1.9, 2.6], [3.6, 5.2], [6.4, 7.6]];
  for (const [a, b] of phrases) {
    for (let i = Math.round(a * SR); i < Math.min(n, Math.round(b * SR)); i++) {
      const t = i / SR;
      const f0 = 150 + 20 * Math.sin(2 * Math.PI * 5 * t);
      const syl = 0.5 + 0.5 * Math.sin(2 * Math.PI * 4 * (t - a));
      let s = 0;
      for (let h = 1; h <= 8; h++) s += Math.sin(2 * Math.PI * f0 * h * t) / h;
      x[i] = 0.18 * syl * s;
    }
  }
  for (let i = 0; i < n; i++) x[i] += noise * (r() * 2 - 1);
  return stereo(x);
}

/** Guitarra em linha: acordes com ataque e decaimento. */
function guitar(seconds: number): Signal {
  const n = SR * seconds;
  const x = new Float32Array(n);
  const chords = [[196, 247, 294], [220, 277, 330], [175, 220, 262], [196, 247, 294]];
  const len = n / chords.length;
  chords.forEach((notes, c) => {
    for (let i = 0; i < len; i++) {
      const t = i / SR;
      const env = Math.exp(-t / 0.6);
      let s = 0;
      for (const f of notes) s += Math.sin(2 * Math.PI * f * t) + 0.3 * Math.sin(4 * Math.PI * f * t);
      x[Math.round(c * len) + i] = 0.12 * env * s;
    }
  });
  return stereo(x, 0.95);
}

/** Bateria: bumbo (seno que desce), caixa (ruído + corpo) e chimbal, em 110 BPM. */
function drums(seconds: number, seed = 7): Signal {
  const r = rng(seed);
  const n = SR * seconds;
  const x = new Float32Array(n);
  const beat = 60 / 110;
  for (let k = 0; k * beat < seconds; k++) {
    const s0 = Math.round(k * beat * SR);
    const snare = k % 2 === 1;
    for (let i = 0; i < SR * 0.4 && s0 + i < n; i++) {
      const t = i / SR;
      if (snare) x[s0 + i] += 0.5 * Math.exp(-t / 0.08) * ((r() * 2 - 1) * 0.7 + 0.3 * Math.sin(2 * Math.PI * 190 * t));
      else x[s0 + i] += 0.8 * Math.exp(-t / 0.12) * Math.sin(2 * Math.PI * (50 + 80 * Math.exp(-t / 0.03)) * t);
    }
    const h0 = Math.round((k + 0.5) * beat * SR);
    for (let i = 0; i < SR * 0.05 && h0 + i < n; i++) x[h0 + i] += 0.12 * Math.exp(-i / SR / 0.015) * (r() * 2 - 1);
  }
  return stereo(x, 0.85);
}

/** Estéreo de verdade: canais com conteúdo diferente (guitarra mais à esquerda, bateria mais à direita, eco de 7 ms). */
function trueStereo(seconds: number): Signal {
  const g = guitar(seconds)[0];
  const d = drums(seconds)[0];
  const delay = Math.round(SR * 0.007);
  const l = new Float32Array(g.length);
  const r = new Float32Array(g.length);
  for (let i = 0; i < g.length; i++) {
    l[i] = 0.9 * g[i] + 0.25 * d[i];
    r[i] = 0.35 * (g[i - delay] ?? 0) + 0.8 * d[i];
  }
  return [l, r];
}

/** Música de fundo: arquivo estéreo a 44,1 kHz, mais curto que a voz (força o loop), preparado como no music-picker. */
function backgroundMusic(): Signal {
  const sr = 44100;
  const n = sr * 6;
  const l = new Float32Array(n);
  const r = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const beat = Math.exp(-((t * 2) % 1) * 6);
    l[i] = 0.2 * (Math.sin(2 * Math.PI * 220 * t) + 0.5 * Math.sin(2 * Math.PI * 277 * t)) + 0.15 * beat * Math.sin(2 * Math.PI * 60 * t);
    r[i] = 0.2 * (Math.sin(2 * Math.PI * 330 * t) + 0.5 * Math.sin(2 * Math.PI * 165 * t)) + 0.15 * beat * Math.sin(2 * Math.PI * 60 * t);
  }
  return prepareMusic({ name: "musica.wav", channels: [l, r], sampleRate: sr }, SR, 2);
}

// ------------------------------------------------------------------ pipeline (igual ao dsp.worker com preroll 0)

type Scenario = {
  input: () => Signal;
  chain: () => ChainDoc;
  intensity: number;
  social: boolean;
  /** 0 = sem remoção de ruído; 0,9 = "leve"; 1 = "forte" (NOISE_AMOUNT). */
  denoise: number;
  impulses?: Record<string, Float32Array>;
  cut?: CutLevel;
  /** Música de fundo, como no export-panel (withMusic = mixMusic + safeCeiling, depois dos cortes). */
  music?: { level: MusicLevel; signal: () => Signal };
};

async function runScenario(s: Scenario): Promise<Signal> {
  const input = s.input();
  const original = input.map((c) => c.slice());
  setDrumSamples(undefined);
  setImpulses(s.impulses);
  let out: Signal = input;
  if (s.denoise > 0) {
    const { denoise } = await import("@/lib/dsp/denoise");
    out = await denoise(out, SR, s.denoise);
  }
  out = runChain(out, SR, s.chain(), s.intensity);
  if (s.social) out = finalizeForSocial(out, SR);
  setImpulses(undefined);
  if (s.cut && s.cut !== "off") {
    const segs = speechSegments(original, SR, 0, s.cut, null);
    out = spliceAudio(out, SR, 0, segs);
  }
  if (s.music) out = safeCeiling(mixMusic(out, s.music.signal(), SR, s.music.level, 0, out[0].length), SR);
  return out;
}

const round = (v: number, d = 6) => (Number.isFinite(v) ? Number(v.toFixed(d)) : String(v));

type Metrics = { channels: number; samples: number; lufs: number; peak: number; rms_500ms: number[] };
type Golden = { sha256_f32: string; metrics: Metrics };

/**
 * Nível 1 (principal): SHA-256 dos bytes float32 de todos os canais — qualquer diferença de 1 bit falha.
 * Nível 2: medidas em precisão total, comparadas com tolerância (ver `close`).
 */
function measure(x: Signal): Golden {
  const hash = createHash("sha256");
  for (const ch of x) hash.update(Buffer.from(ch.buffer, ch.byteOffset, ch.byteLength));
  const hop = SR / 2;
  const rms: number[] = [];
  for (let a = 0; a < x[0].length; a += hop) {
    let s = 0;
    let c = 0;
    for (const ch of x) for (let i = a; i < Math.min(a + hop, ch.length); i++, c++) s += ch[i] * ch[i];
    rms.push(Math.sqrt(s / Math.max(1, c)));
  }
  return {
    sha256_f32: hash.digest("hex"),
    metrics: { channels: x.length, samples: x[0].length, lufs: integratedLoudness(x, SR), peak: samplePeak(x), rms_500ms: rms },
  };
}

/**
 * Tolerâncias do nível 2 (para rodar em outro sistema/versão do Node, ex.: servidor Linux):
 * - canais e amostras: exatos (o tamanho do arquivo não pode mudar);
 * - pico e RMS por janela: 1e-6 relativo (+1e-9 absoluto para janelas quase em silêncio). O áudio é
 *   float32 (épsilon 1,2e-7), então 1e-6 deixa folga para alguns arredondamentos diferentes de
 *   Math.sin/exp/pow entre plataformas, mas pega qualquer mudança real (0,01 dB = 1,2e-3);
 * - LUFS: 1e-5 dB absoluto. Está em escala logarítmica, onde "relativo" não faz sentido;
 *   1e-5 dB ≈ 2,3e-6 relativo em energia, a mesma ordem dos 1e-6 da amplitude.
 */
const REL = 1e-6;
const ABS_FLOOR = 1e-9;
const LUFS_DB = 1e-5;

function close(got: Metrics, want: Metrics): string[] {
  const bad: string[] = [];
  const amp = (k: string, a: number, b: number) => {
    if (Math.abs(a - b) > REL * Math.max(Math.abs(a), Math.abs(b)) + ABS_FLOOR) bad.push(`${k}: ${a} ≠ ${b}`);
  };
  if (got.channels !== want.channels) bad.push(`canais: ${got.channels} ≠ ${want.channels}`);
  if (got.samples !== want.samples) bad.push(`amostras: ${got.samples} ≠ ${want.samples}`);
  if (!(Math.abs(got.lufs - want.lufs) <= LUFS_DB)) bad.push(`LUFS: ${got.lufs} ≠ ${want.lufs}`);
  amp("pico", got.peak, want.peak);
  if (got.rms_500ms.length !== want.rms_500ms.length) bad.push("número de janelas de RMS");
  else got.rms_500ms.forEach((v, i) => amp(`RMS[${i}]`, v, want.rms_500ms[i]));
  return bad;
}

const clone = (d: ChainDoc): ChainDoc => JSON.parse(JSON.stringify(d));
const greenback = CABS.find((c) => c.id === "mp:g-4x12-greenback")!;

const SCENARIOS: Record<string, Scenario> = {
  "1-voz-ruido-leve": {
    input: () => voice(8, 0.01),
    chain: () => clone(CHAINS["criador-youtuber"]),
    intensity: 75,
    social: false,
    denoise: 0.9,
  },
  "2-guitarra-amp-ir": {
    input: () => guitar(4),
    chain: () => {
      const d = clone(CHAINS["guitarra-amp-rock"]);
      // a migração 0008 (set_amp_ir) pôs a caixa embutida neste preset
      d.chain[0].params = { ...d.chain[0].params, ir: greenback.id };
      return d;
    },
    intensity: 75,
    social: false,
    denoise: 0,
    impulses: { [greenback.id]: synthCabIR(greenback, SR) },
  },
  "3-bateria-drum-studio": {
    input: () => drums(4),
    chain: () => clone(CHAINS["bateria-pop-rock"]),
    intensity: 75,
    social: false,
    denoise: 0,
  },
  "4-master-no-fim": {
    input: () => guitar(4),
    chain: () =>
      withMaster(clone(CHAINS["violao-cel-natural"]), {
        chain: clone(CHAINS["master-pop-moderno"]),
        defaultIntensity: 75,
      } as StudioPreset),
    intensity: 50,
    social: false,
    denoise: 0,
  },
  "5a-redes-desligado": {
    input: () => voice(8, 0.003, 2),
    chain: () => clone(CHAINS["criador-youtuber"]),
    intensity: 50,
    social: false,
    denoise: 0,
  },
  "5b-redes-ligado": {
    input: () => voice(8, 0.003, 2),
    chain: () => clone(CHAINS["criador-youtuber"]),
    intensity: 50,
    social: true,
    denoise: 0,
  },
  "6a-cortes-suave": {
    input: () => voice(8, 0.002, 3),
    chain: () => clone(CHAINS["criador-youtuber"]),
    intensity: 100,
    social: true,
    denoise: 0,
    cut: "suave",
  },
  "6b-cortes-dinamico": {
    input: () => voice(8, 0.002, 3),
    chain: () => clone(CHAINS["criador-youtuber"]),
    intensity: 100,
    social: true,
    denoise: 1,
    cut: "dinamico",
  },
  // mesmo preset do cenário 2 em outra intensidade: trava a interpolação valor/neutro da cadeia
  "7-intensidade-50-guitarra": {
    input: () => guitar(4),
    chain: () => {
      const d = clone(CHAINS["guitarra-amp-rock"]);
      d.chain[0].params = { ...d.chain[0].params, ir: greenback.id };
      return d;
    },
    intensity: 50,
    social: false,
    denoise: 0,
    impulses: { [greenback.id]: synthCabIR(greenback, SR) },
  },
  "8a-musica-media": {
    input: () => voice(8, 0.003, 2),
    chain: () => clone(CHAINS["criador-youtuber"]),
    intensity: 75,
    social: true,
    denoise: 0,
    music: { level: "media", signal: backgroundMusic },
  },
  "8b-musica-alta-com-cortes": {
    input: () => voice(8, 0.002, 3),
    chain: () => clone(CHAINS["criador-youtuber"]),
    intensity: 75,
    social: true,
    denoise: 0,
    cut: "suave",
    music: { level: "alta", signal: backgroundMusic },
  },
  "9-estereo-real-master": {
    input: () => trueStereo(4),
    chain: () => clone(CHAINS["master-pop-moderno"]),
    intensity: 75,
    social: true,
    denoise: 0,
  },
  "10-mono-1-canal": {
    input: () => [voice(8, 0.01, 4)[0]],
    chain: () => clone(CHAINS["criador-youtuber"]),
    intensity: 75,
    social: true,
    denoise: 0.9,
  },
};

// ------------------------------------------------------------------ vídeo (funções puras)

function videoGolden() {
  const formats: VideoFormat[] = ["original", "9:16", "1:1", "4:5", "16:9"];
  const sources = [[1920, 1080], [1080, 1920], [720, 1280], [3840, 2160], [641, 359]];
  const sizes = Object.fromEntries(
    sources.map(([w, h]) => [`${w}x${h}`, Object.fromEntries(formats.map((f) => [f, outputSize(w, h, f)]))]),
  );
  const plain: Look = { format: "original", fit: "blur", watermark: false, captions: null, fontFamily: "x", color: null, cta: null };
  const looks: Record<string, Look> = {
    nada: plain,
    formato: { ...plain, format: "9:16" },
    selo: { ...plain, watermark: true },
    legenda: { ...plain, captions: {} as Look["captions"] },
    antes_depois: { ...plain, beforeAfter: { split: 3 } },
    cor_padrao: { ...plain, color: DEFAULT_LOOK },
    cor_vibrante: { ...plain, color: { ...DEFAULT_LOOK, filter: "vibrante" } },
    cta_vazio: { ...plain, cta: { text: "  ", handle: "@x", start: 1, end: 2 } },
    cta: { ...plain, cta: { text: "Siga", handle: "@x", start: 1, end: 2 } },
  };
  const render = Object.fromEntries(
    Object.entries(looks).flatMap(([k, l]) => [[`${k}`, needsRender(l, false)], [`${k}+cortes`, needsRender(l, true)]]),
  );
  const color = Object.fromEntries(
    FILTERS.flatMap((f) =>
      [100, 50].map((amount) => {
        const look = { ...DEFAULT_LOOK, filter: f.id, amount };
        return [`${f.id}@${amount}`, { active: lookIsActive(look), matrix: lookMatrix(look).map((v) => round(v, 5)) }];
      }),
    ),
  );
  const cuts = Object.fromEntries(
    (["off", "suave", "dinamico"] as CutLevel[]).map((lv) => [
      lv,
      speechSegments(voice(8, 0.002, 3), SR, 1.5, lv, null).map((s) => [round(s.start, 4), round(s.end, 4)]),
    ]),
  );
  return { sizes, render, color, cuts };
}

// ------------------------------------------------------------------ comparação

const golden: Record<string, unknown> = existsSync(GOLDEN_FILE) ? JSON.parse(readFileSync(GOLDEN_FILE, "utf8")) : {};
const fresh: Record<string, unknown> = {};
const audioGolden = (k: string) => golden[k] as Golden;

for (const [name, s] of Object.entries(SCENARIOS)) {
  let got: Golden;
  test(`golden áudio [exato]: ${name}`, async () => {
    got = measure(await runScenario(s));
    fresh[name] = got;
    if (UPDATE) return;
    assert.ok(golden[name], `sem golden para ${name} (rode com UPDATE_GOLDEN=1)`);
    assert.equal(got.sha256_f32, audioGolden(name).sha256_f32, `impressão digital exata diferente em ${name}`);
  });
  test(`golden áudio [tolerância]: ${name}`, () => {
    if (UPDATE) return;
    const bad = close(got.metrics, audioGolden(name).metrics);
    assert.deepEqual(bad, [], `medidas fora da tolerância em ${name}:\n${bad.join("\n")}`);
  });
  // o caminho novo (processAudio, usado pelo dsp.worker e pelo script Node) contra o mesmo golden
  test(`golden áudio [processAudio]: ${name}`, async () => {
    if (UPDATE) return;
    const { processAudio } = await import("./process-audio");
    const input = s.input();
    const original = input.map((c) => c.slice());
    const r = await processAudio(input, SR, { chain: s.chain(), intensity: s.intensity, social: s.social, denoise: s.denoise, preroll: 0, impulses: s.impulses });
    let out = r.channels;
    if (s.cut && s.cut !== "off") out = spliceAudio(out, SR, 0, speechSegments(original, SR, 0, s.cut, null));
    if (s.music) out = safeCeiling(mixMusic(out, s.music.signal(), SR, s.music.level, 0, out[0].length), SR);
    assert.equal(measure(out).sha256_f32, audioGolden(name).sha256_f32, `processAudio diferente do golden em ${name}`);
  });
}

test("golden vídeo: tamanhos, recodificação, cor e cortes", () => {
  const got = JSON.parse(JSON.stringify(videoGolden()));
  fresh.video = got;
  if (UPDATE) return;
  assert.deepEqual(got, golden.video);
});

test("golden: os cenários são de fato diferentes entre si", () => {
  if (UPDATE) {
    writeFileSync(GOLDEN_FILE, JSON.stringify(fresh, null, 1) + "\n");
    return;
  }
  const hashes = Object.keys(SCENARIOS).map((k) => audioGolden(k).sha256_f32);
  assert.equal(new Set(hashes).size, hashes.length);
  const m = (k: string) => audioGolden(k).metrics;
  const on = m("5b-redes-ligado");
  assert.ok(Math.abs(on.lufs - -14) < 0.6, `redes ligado deve ficar perto de -14 LUFS (${on.lufs})`);
  assert.ok(on.peak <= 10 ** (-1 / 20) + 1e-3);
  assert.notEqual(m("5a-redes-desligado").lufs, on.lufs);
  for (const k of ["6a-cortes-suave", "6b-cortes-dinamico", "8b-musica-alta-com-cortes"])
    assert.ok(m(k).samples < on.samples, `${k} deve encurtar o áudio`);
  assert.equal(m("8a-musica-media").samples, on.samples, "a música não muda a duração");
  assert.equal(m("10-mono-1-canal").channels, 1);
  assert.equal(m("9-estereo-real-master").channels, 2);
});
