/**
 * Análise musical (sem bibliotecas): andamento (BPM), tonalidade e espectro por oitava.
 * Funções puras, usadas no servidor (ferramentas) e no aparelho (mostrar BPM e tom no Estúdio).
 *  - BPM: envelope de ataques (fluxo de energia em bandas) → autocorrelação entre 60 e 200 BPM,
 *    com preferência suave por andamentos perto de 110 (evita escolher o dobro ou a metade).
 *  - Tonalidade: cromagrama (FFT, 55 Hz–2 kHz) correlacionado com os perfis de Krumhansl–Kessler.
 *  - Espectro: energia média em bandas de oitava (31,5 Hz a 16 kHz), em dB.
 */
import { fft } from "@/lib/dsp/convolve";
import { resampleMono } from "@/lib/dsp/resample";
import type { Signal } from "@/lib/dsp/types";

const ANALYSIS_SR = 11025;

/** Mono reamostrado para análise, no máximo `maxS` segundos do meio do arquivo. */
export function analysisMono(audio: Signal, sr: number, maxS = 120): Float32Array<ArrayBuffer> {
  let x = resampleMono(audio, sr, ANALYSIS_SR);
  const max = Math.round(maxS * ANALYSIS_SR);
  if (x.length > max) {
    const start = Math.floor((x.length - max) / 2);
    x = x.slice(start, start + max);
  }
  return x;
}

function hann(n: number): Float64Array {
  const w = new Float64Array(n);
  for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1));
  return w;
}

/** Magnitudes de quadros de FFT (n potência de 2), para cada quadro chama `each(mag)`. */
function stft(x: Float32Array, n: number, hop: number, each: (mag: Float64Array) => void) {
  const w = hann(n);
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  const mag = new Float64Array(n / 2);
  for (let s = 0; s + n <= x.length; s += hop) {
    for (let i = 0; i < n; i++) {
      re[i] = x[s + i] * w[i];
      im[i] = 0;
    }
    fft(re, im);
    for (let k = 0; k < n / 2; k++) mag[k] = Math.hypot(re[k], im[k]);
    each(mag);
  }
}

export type TempoResult = { bpm: number; confidence: number };

const BAND_WEIGHT = [2, 1.2, 1, 0.6];

export function detectBpm(audio: Signal, sr: number): TempoResult | null {
  const x = analysisMono(audio, sr, 90);
  const n = 1024;
  const hop = 256; // ~43 quadros por segundo
  const fps = ANALYSIS_SR / hop;
  const bandsHz = [[40, 150], [150, 600], [600, 2500], [2500, 5500]];
  const bins = bandsHz.map(([a, b]) => [Math.floor((a * n) / ANALYSIS_SR), Math.ceil((b * n) / ANALYSIS_SR)]);
  const prev = new Float64Array(bins.length);
  const env: number[] = [];
  stft(x, n, hop, (mag) => {
    let flux = 0;
    bins.forEach(([a, b], j) => {
      let e = 0;
      for (let k = a; k < b; k++) e += mag[k];
      const v = Math.log1p(e);
      // graves pesam mais: o pulso costuma estar no bumbo, não no chimbal
      flux += Math.max(0, v - prev[j]) * BAND_WEIGHT[j];
      prev[j] = v;
    });
    env.push(flux);
  });
  if (env.length < fps * 6) return null;
  // tira a tendência (média móvel de ~0,5 s)
  const win = Math.round(fps / 2);
  const o0 = env.map((v, i) => {
    let s = 0;
    let c = 0;
    for (let k = Math.max(0, i - win); k <= Math.min(env.length - 1, i + win); k++) {
      s += env[k];
      c++;
    }
    return Math.max(0, v - s / c);
  });
  // suaviza os picos (1 quadro ≈ 23 ms): o intervalo real raramente é um número inteiro de quadros
  const o = o0.map((_, i) => {
    let s = 0;
    for (let k = -2; k <= 2; k++) s += (o0[i + k] ?? 0) * (3 - Math.abs(k));
    return s / 9;
  });
  const minLag = Math.floor((60 / 200) * fps);
  const maxLag = Math.ceil((60 / 60) * fps);
  // autocorrelação até o dobro do maior intervalo (para a estrutura métrica)
  const ac = new Float64Array(2 * maxLag + 2);
  for (let lag = minLag; lag <= 2 * maxLag + 1 && lag < o.length; lag++) {
    let s = 0;
    for (let i = lag; i < o.length; i++) s += o[i] * o[i - lag];
    ac[lag] = s / (o.length - lag);
  }
  let best = 0;
  let bestLag = 0;
  const scores: number[] = [];
  let mean = 0;
  for (let lag = minLag; lag <= maxLag; lag++) {
    // o pulso verdadeiro também se repete no compasso (2× o intervalo)
    const s = ac[lag] + 0.5 * ac[2 * lag];
    const bpm = (60 * fps) / lag;
    const prior = Math.exp(-0.5 * (Math.log2(bpm / 110) / 0.9) ** 2);
    const w = s * (0.5 + prior);
    scores.push(w);
    mean += w;
    if (w > best) {
      best = w;
      bestLag = lag;
    }
  }
  if (!bestLag || best <= 0) return null;
  mean /= scores.length;
  // refina o pico (interpolação parabólica)
  const i = bestLag - minLag;
  const a = scores[i - 1] ?? best;
  const c = scores[i + 1] ?? best;
  const shift = a + c - 2 * best !== 0 ? (0.5 * (a - c)) / (a - 2 * best + c) : 0;
  const bpm = (60 * fps) / (bestLag + Math.max(-0.5, Math.min(0.5, shift)));
  return { bpm: Math.round(bpm * 10) / 10, confidence: Math.max(0, Math.min(1, (best - mean) / (best + 1e-12))) };
}

const NOTES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const NOTES_PT = ["Dó", "Dó#", "Ré", "Ré#", "Mi", "Fá", "Fá#", "Sol", "Sol#", "Lá", "Lá#", "Si"];
const MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

export type KeyResult = { tonic: number; mode: "major" | "minor"; name: string; label: string; confidence: number };

function corr(a: number[], b: number[]): number {
  const ma = a.reduce((s, v) => s + v, 0) / a.length;
  const mb = b.reduce((s, v) => s + v, 0) / b.length;
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < a.length; i++) {
    num += (a[i] - ma) * (b[i] - mb);
    da += (a[i] - ma) ** 2;
    db += (b[i] - mb) ** 2;
  }
  return num / Math.sqrt(da * db + 1e-12);
}

export function chroma(audio: Signal, sr: number): number[] {
  const x = analysisMono(audio, sr, 120);
  const n = 8192;
  const c = new Array(12).fill(0);
  const pcOfBin: number[] = [];
  for (let k = 0; k < n / 2; k++) {
    const f = (k * ANALYSIS_SR) / n;
    pcOfBin.push(f < 55 || f > 2000 ? -1 : (((Math.round(12 * Math.log2(f / 440)) + 9) % 12) + 12) % 12);
  }
  stft(x, n, n / 2, (mag) => {
    for (let k = 0; k < mag.length; k++) {
      const pc = pcOfBin[k];
      if (pc >= 0) c[pc] += Math.log1p(mag[k]);
    }
  });
  return c;
}

export function detectKey(audio: Signal, sr: number): KeyResult | null {
  const c = chroma(audio, sr);
  if (c.every((v) => v === 0)) return null;
  const scores: { tonic: number; mode: "major" | "minor"; r: number }[] = [];
  for (let t = 0; t < 12; t++) {
    const rot = (p: number[]) => p.map((_, i) => p[(i - t + 12) % 12]);
    scores.push({ tonic: t, mode: "major", r: corr(c, rot(MAJOR)) });
    scores.push({ tonic: t, mode: "minor", r: corr(c, rot(MINOR)) });
  }
  scores.sort((a, b) => b.r - a.r);
  const top = scores[0];
  const name = `${NOTES[top.tonic]}${top.mode === "minor" ? "m" : ""}`;
  const label = `${NOTES_PT[top.tonic]} ${top.mode === "major" ? "maior" : "menor"}`;
  return { tonic: top.tonic, mode: top.mode, name, label, confidence: Math.max(0, Math.min(1, (top.r - scores[1].r) * 5)) };
}

/** Nome do tom depois de transpor `semitones` (para mostrar "Ré maior → Mi maior"). */
export function transposeKey(k: KeyResult, semitones: number): KeyResult {
  const tonic = (((k.tonic + Math.round(semitones)) % 12) + 12) % 12;
  return { ...k, tonic, name: `${NOTES[tonic]}${k.mode === "minor" ? "m" : ""}`, label: `${NOTES_PT[tonic]} ${k.mode === "major" ? "maior" : "menor"}` };
}

export const OCTAVE_CENTERS = [31.5, 63, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];

/** Energia média por banda de oitava (dB, relativo), na taxa original do áudio. */
export function octaveSpectrumDb(audio: Signal, sr: number, maxS = 120): number[] {
  const nCh = audio.length;
  let len = audio[0].length;
  let start = 0;
  if (len > sr * maxS) {
    start = Math.floor((len - sr * maxS) / 2);
    len = sr * maxS;
  }
  const mono = new Float32Array(len);
  for (const ch of audio) for (let i = 0; i < len; i++) mono[i] += ch[start + i] / nCh;
  const n = 8192;
  const acc = new Float64Array(OCTAVE_CENTERS.length);
  let frames = 0;
  const edges = OCTAVE_CENTERS.map((f) => [f / Math.SQRT2, Math.min(f * Math.SQRT2, sr / 2)]);
  stft(mono, n, n, (mag) => {
    frames++;
    edges.forEach(([a, b], j) => {
      const ka = Math.max(1, Math.floor((a * n) / sr));
      const kb = Math.min(n / 2 - 1, Math.ceil((b * n) / sr));
      let e = 0;
      for (let k = ka; k <= kb; k++) e += mag[k] * mag[k];
      acc[j] += e;
    });
  });
  return Array.from(acc, (e) => 10 * Math.log10(e / Math.max(1, frames) + 1e-20));
}
