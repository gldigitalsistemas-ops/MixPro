/**
 * Acordes ao longo da música (maiores e menores + "sem acorde"): cromagrama por quadros de 0,25 s
 * (FFT de 8192 mapeada em 12 notas, 55 Hz–2 kHz), modelos de tríade e suavização de Viterbi (acorde
 * tende a continuar). Serve para a folha de cifra da base e para conferir se a base gerada respeita
 * a harmonia da guia do compositor.
 */
import { fft } from "@/lib/dsp/convolve";
import type { Signal } from "@/lib/dsp/types";

const NOTES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
export const CHORD_NAMES = [...NOTES, ...NOTES.map((n) => `${n}m`), "N"];

export type ChordSegment = { start: number; end: number; chord: string };

const HOP_S = 0.25;

function chromagram(x: Signal, sr: number): number[][] {
  const N = 8192;
  const hop = Math.round(HOP_S * sr);
  const n = x[0].length;
  const win = new Float64Array(N).map((_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1)));
  const bins: { k: number; pc: number }[] = [];
  for (let k = 1; k < N / 2; k++) {
    const f = (k * sr) / N;
    if (f < 55 || f > 2000) continue;
    const midi = 69 + 12 * Math.log2(f / 440);
    bins.push({ k, pc: ((Math.round(midi) % 12) + 12) % 12 });
  }
  const frames: number[][] = [];
  for (let s = 0; s + N <= n; s += hop) {
    const re = new Float64Array(N);
    const im = new Float64Array(N);
    for (let i = 0; i < N; i++) {
      let v = 0;
      for (const ch of x) v += ch[s + i];
      re[i] = (v / x.length) * win[i];
    }
    fft(re, im);
    const c = new Array(12).fill(0);
    for (const { k, pc } of bins) c[pc] += Math.sqrt(re[k] * re[k] + im[k] * im[k]);
    frames.push(c);
  }
  return frames;
}

function templates(): number[][] {
  const t: number[][] = [];
  for (const third of [4, 3]) {
    for (let r = 0; r < 12; r++) {
      const v = new Array(12).fill(0);
      v[r] = 1;
      v[(r + third) % 12] = 0.8;
      v[(r + 7) % 12] = 0.9;
      t.push(v);
    }
  }
  return t;
}

const cos = (a: number[], b: number[]) => {
  let ab = 0;
  let aa = 0;
  let bb = 0;
  for (let i = 0; i < 12; i++) {
    ab += a[i] * b[i];
    aa += a[i] * a[i];
    bb += b[i] * b[i];
  }
  return aa && bb ? ab / Math.sqrt(aa * bb) : 0;
};

export function detectChords(x: Signal, sr: number): ChordSegment[] {
  const frames = chromagram(x, sr);
  if (!frames.length) return [];
  const T = templates();
  const energies = frames.map((f) => f.reduce((a, b) => a + b, 0));
  const maxE = Math.max(...energies);
  // pontuação por quadro: 24 acordes + "sem acorde" (quadros fracos)
  const score = frames.map((f, i) => {
    const s = T.map((t) => cos(f, t));
    s.push(energies[i] < maxE * 0.05 ? 1 : 0.3);
    return s;
  });
  // Viterbi: trocar de acorde custa (favorece acordes que duram)
  const K = 25;
  const stay = 0.15;
  let prev = score[0].slice();
  const back: Int16Array[] = [];
  for (let i = 1; i < score.length; i++) {
    const bi = new Int16Array(K);
    const cur = new Array(K).fill(0);
    let bestPrev = 0;
    for (let k = 1; k < K; k++) if (prev[k] > prev[bestPrev]) bestPrev = k;
    for (let k = 0; k < K; k++) {
      const viaStay = prev[k] + stay;
      const viaJump = prev[bestPrev];
      bi[k] = viaStay >= viaJump ? k : bestPrev;
      cur[k] = Math.max(viaStay, viaJump) + score[i][k];
    }
    back.push(bi);
    prev = cur;
  }
  let k = prev.indexOf(Math.max(...prev));
  const path = [k];
  for (let i = back.length - 1; i >= 0; i--) {
    k = back[i][k];
    path.push(k);
  }
  path.reverse();
  const segs: ChordSegment[] = [];
  path.forEach((c, i) => {
    const name = CHORD_NAMES[c];
    const last = segs[segs.length - 1];
    if (last && last.chord === name) last.end = (i + 1) * HOP_S;
    else segs.push({ start: i * HOP_S, end: (i + 1) * HOP_S, chord: name });
  });
  return segs;
}

/** Fração do tempo (com acorde nos dois) em que os acordes coincidem. */
export function chordAgreement(a: ChordSegment[], b: ChordSegment[], step = 0.25): number {
  const at = (s: ChordSegment[], t: number) => s.find((x) => t >= x.start && t < x.end)?.chord ?? "N";
  const end = Math.min(a[a.length - 1]?.end ?? 0, b[b.length - 1]?.end ?? 0);
  let both = 0;
  let same = 0;
  for (let t = 0; t < end; t += step) {
    const ca = at(a, t);
    const cb = at(b, t);
    if (ca === "N" || cb === "N") continue;
    both++;
    if (ca === cb) same++;
  }
  return both ? same / both : 0;
}

/** Progressão resumida (sem repetições seguidas, sem trechos menores que 0,75 s). */
export function progression(segs: ChordSegment[]): string[] {
  const out: string[] = [];
  for (const s of segs) {
    if (s.chord === "N" || s.end - s.start < 0.75) continue;
    if (out[out.length - 1] !== s.chord) out.push(s.chord);
  }
  return out;
}

/** Nome em português para a folha de cifra (ex.: "Am" → "Lá menor"). */
const PT = ["Dó", "Dó#", "Ré", "Ré#", "Mi", "Fá", "Fá#", "Sol", "Sol#", "Lá", "Lá#", "Si"];
export const chordPt = (c: string) => {
  if (c === "N") return "—";
  const minor = c.endsWith("m");
  const root = NOTES.indexOf(minor ? c.slice(0, -1) : c);
  return root < 0 ? c : `${PT[root]}${minor ? " menor" : ""}`;
};
