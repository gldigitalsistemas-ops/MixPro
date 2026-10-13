/**
 * Afinação natural de voz (sem efeito robótico):
 *   1. Detecção da frequência fundamental (YIN, de Cheveigné & Kawahara 2002) num sinal reduzido a 16 kHz.
 *   2. Segmentação em notas (trechos com voz e altura estável).
 *   3. Correção do CENTRO de cada nota para a nota-alvo (escala da música ou a melodia do compositor),
 *      na proporção escolhida — vibrato, deslizes e a expressão dentro da nota ficam intactos.
 *   4. Resíntese por PSOLA (sobreposição de grãos de um período): muda a altura sem mudar a duração
 *      e preserva o timbre (formantes) para correções pequenas, que é o caso da afinação.
 */
import { resampleMono } from "@/lib/dsp/resample";
import type { Signal } from "@/lib/dsp/types";

const PITCH_SR = 16000;
const FRAME = 768;
const HOP = 160; // 10 ms
const FMIN = 75;
const FMAX = 1000;

export type PitchTrack = { hopS: number; f0: Float32Array; voiced: Uint8Array };

/** YIN: f0 por quadro (0 = sem voz). */
export function trackPitch(audio: Signal, sr: number): PitchTrack {
  const x = resampleMono(audio as Float32Array<ArrayBuffer>[], sr, PITCH_SR);
  const frames = Math.max(0, Math.floor((x.length - FRAME) / HOP) + 1);
  const tauMin = Math.floor(PITCH_SR / FMAX);
  const tauMax = Math.min(Math.floor(PITCH_SR / FMIN), FRAME / 2);
  const f0 = new Float32Array(frames);
  const voiced = new Uint8Array(frames);
  const d = new Float64Array(tauMax + 1);
  // silêncio relativo: 45 dB abaixo do pico do trecho
  let peak = 0;
  for (let i = 0; i < x.length; i++) peak = Math.max(peak, Math.abs(x[i]));
  const silence = (peak * 10 ** (-45 / 20)) ** 2;
  for (let f = 0; f < frames; f++) {
    const o = f * HOP;
    let energy = 0;
    for (let i = 0; i < FRAME; i++) energy += x[o + i] * x[o + i];
    if (energy / FRAME < silence) continue;
    const W = FRAME - tauMax;
    d[0] = 0;
    let run = 0;
    let best = -1;
    for (let tau = 1; tau <= tauMax; tau++) {
      let s = 0;
      for (let i = 0; i < W; i++) {
        const v = x[o + i] - x[o + i + tau];
        s += v * v;
      }
      run += s;
      d[tau] = run > 0 ? (s * tau) / run : 1;
    }
    for (let tau = tauMin; tau < tauMax; tau++) {
      if (d[tau] < 0.15) {
        while (tau + 1 < tauMax && d[tau + 1] < d[tau]) tau++;
        best = tau;
        break;
      }
    }
    if (best < 0) continue;
    // interpolação parabólica do mínimo
    const a = d[best - 1] ?? d[best];
    const b = d[best];
    const c = d[best + 1] ?? d[best];
    const den = a - 2 * b + c;
    const t = den !== 0 ? best + (0.5 * (a - c)) / den : best;
    f0[f] = PITCH_SR / t;
    voiced[f] = 1;
  }
  // remove "pulos" isolados de oitava (um quadro fora do vizinho)
  for (let f = 1; f + 1 < frames; f++) {
    if (voiced[f] && voiced[f - 1] && voiced[f + 1]) {
      const r = f0[f] / Math.sqrt(f0[f - 1] * f0[f + 1]);
      if (r > 1.8 || r < 0.55) f0[f] = Math.sqrt(f0[f - 1] * f0[f + 1]);
    }
  }
  return { hopS: HOP / PITCH_SR, f0, voiced };
}

export const hzToMidi = (f: number) => 69 + 12 * Math.log2(f / 440);
export const midiToHz = (m: number) => 440 * 2 ** ((m - 69) / 12);

/** Notas da escala (classes de altura 0–11) a partir da tônica e do modo. */
export function scaleOf(tonic: number, mode: "major" | "minor"): number[] {
  const steps = mode === "major" ? [0, 2, 4, 5, 7, 9, 11] : [0, 2, 3, 5, 7, 8, 10];
  return steps.map((s) => (tonic + s) % 12);
}

/** Nota da escala mais próxima de uma altura (em MIDI fracionário). */
export function nearestInScale(midi: number, scale: number[]): number {
  let best = Math.round(midi);
  let dist = Infinity;
  for (let n = Math.floor(midi) - 2; n <= Math.ceil(midi) + 2; n++) {
    if (!scale.includes(((n % 12) + 12) % 12)) continue;
    const dd = Math.abs(n - midi);
    if (dd < dist) {
      dist = dd;
      best = n;
    }
  }
  return best;
}

export type Note = { start: number; end: number; midi: number };

/** Segmenta a voz em notas: trechos com voz cuja altura mediana muda de nota por mais de 60 ms. */
export function segmentNotes(track: PitchTrack): Note[] {
  const { f0, voiced, hopS } = track;
  const notes: Note[] = [];
  const minFrames = Math.round(0.06 / hopS);
  let i = 0;
  while (i < f0.length) {
    if (!voiced[i]) {
      i++;
      continue;
    }
    let j = i;
    while (j < f0.length && voiced[j]) j++;
    // dentro do trecho com voz: divide quando a nota arredondada muda e se mantém
    let s = i;
    let cur = Math.round(hzToMidi(f0[i]));
    let k = i;
    while (k < j) {
      const m = Math.round(hzToMidi(f0[k]));
      if (m !== cur) {
        let hold = k;
        while (hold < j && Math.round(hzToMidi(f0[hold])) === m) hold++;
        if (hold - k >= minFrames) {
          if (k - s >= minFrames) notes.push(noteOf(f0, s, k, hopS));
          s = k;
          cur = m;
        }
        k = Math.max(hold, k + 1);
      } else k++;
    }
    if (j - s >= minFrames) notes.push(noteOf(f0, s, j, hopS));
    i = j;
  }
  return notes;
}

function noteOf(f0: Float32Array, a: number, b: number, hopS: number): Note {
  const m = Array.from(f0.subarray(a, b), hzToMidi).sort((x, y) => x - y);
  return { start: a * hopS, end: b * hopS, midi: m[Math.floor(m.length / 2)] };
}

export type TuneOptions = {
  /** 0–1: quanto do desvio do centro da nota é corrigido. */
  amount: number;
  /** Escala da música (classes de altura); usada quando não há melodia. */
  scale?: number[];
  /** Melodia-alvo (MIDI, início e fim em s): afina para a nota que o compositor cantou. */
  melody?: [number, number, number][] | null;
};

/** Desvio em semitons por nota (alvo − centro), já na proporção escolhida. */
export function noteShifts(notes: Note[], o: TuneOptions): { note: Note; shift: number; target: number }[] {
  const scale = o.scale ?? [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
  return notes.map((note) => {
    let target = nearestInScale(note.midi, scale);
    if (o.melody?.length) {
      const mid = (note.start + note.end) / 2;
      const m = o.melody.find(([, a, b]) => mid >= a && mid <= b);
      if (m) {
        // mesma nota da melodia, na oitava mais próxima da que foi cantada
        const pc = m[0];
        target = pc + 12 * Math.round((note.midi - pc) / 12);
      }
    }
    const dev = target - note.midi;
    // desvio grande demais (> 0,9 semitom) provavelmente é outra nota cantada de propósito: não mexe
    const shift = Math.abs(dev) > 0.9 ? 0 : dev * Math.max(0, Math.min(1, o.amount));
    return { note, shift, target };
  });
}

/**
 * Aplica a afinação. Devolve um sinal NOVO (o original fica intacto) e o resumo (centavos corrigidos).
 * Sem voz detectada ou com quantidade 0, devolve uma cópia.
 */
export function tuneVocal(audio: Signal, sr: number, o: TuneOptions): { out: Signal; report: { notes: number; avgCents: number; maxCents: number } } {
  const copy = audio.map((c) => c.slice()) as Signal;
  if (o.amount <= 0) return { out: copy, report: { notes: 0, avgCents: 0, maxCents: 0 } };
  const track = trackPitch(audio, sr);
  const shifts = noteShifts(segmentNotes(track), o).filter((s) => Math.abs(s.shift) * 100 >= 2);
  if (!shifts.length) return { out: copy, report: { notes: 0, avgCents: 0, maxCents: 0 } };

  // razão de altura por amostra (1 fora das notas), com rampas de 25 ms nas bordas
  const n = audio[0].length;
  const ratio = new Float32Array(n).fill(1);
  const ramp = Math.round(0.025 * sr);
  for (const { note, shift } of shifts) {
    const a = Math.max(0, Math.round(note.start * sr));
    const b = Math.min(n, Math.round(note.end * sr) + Math.round((FRAME / PITCH_SR) * sr));
    const r = 2 ** (shift / 12);
    for (let i = a; i < b; i++) {
      const w = Math.min(1, (i - a) / ramp, (b - 1 - i) / ramp);
      ratio[i] = 1 + (r - 1) * Math.max(0, w);
    }
  }

  // período local (em amostras do sinal original) a partir do f0, para as marcas de pitch
  const period = (i: number) => {
    const f = Math.min(track.f0.length - 1, Math.max(0, Math.floor(i / sr / track.hopS)));
    let hz = track.f0[f];
    if (!hz) {
      // fora da voz: usa o vizinho mais próximo com voz
      for (let k = 1; k < 8 && !hz; k++) hz = track.f0[f - k] || track.f0[f + k] || 0;
    }
    return hz ? sr / hz : 0;
  };

  const mono = new Float32Array(n);
  for (const ch of audio) for (let i = 0; i < n; i++) mono[i] += ch[i] / audio.length;

  for (const { note } of shifts) {
    const a = Math.max(0, Math.round(note.start * sr) - ramp);
    const b = Math.min(n, Math.round(note.end * sr) + Math.round((FRAME / PITCH_SR) * sr) + ramp);
    psolaRegion(audio, copy, mono, a, b, ratio, period);
  }
  const cents = shifts.map((s) => Math.abs(s.shift) * 100);
  return { out: copy, report: { notes: shifts.length, avgCents: Math.round(cents.reduce((x, y) => x + y, 0) / cents.length), maxCents: Math.round(Math.max(...cents)) } };
}

/** PSOLA num trecho [a, b): marcas nos picos de cada período e grãos de 2 períodos com janela de Hann. */
function psolaRegion(src: Signal, dst: Signal, mono: Float32Array, a: number, b: number, ratio: Float32Array, period: (i: number) => number) {
  const marks: number[] = [];
  let t = a;
  const p0 = period(a);
  if (!p0) return;
  // primeira marca: pico no primeiro período
  let best = t;
  for (let i = t; i < Math.min(b, t + p0); i++) if (Math.abs(mono[i]) > Math.abs(mono[best])) best = i;
  t = best;
  while (t < b) {
    marks.push(t);
    const p = period(t) || p0;
    const lo = Math.round(t + 0.8 * p);
    const hi = Math.round(t + 1.2 * p);
    if (lo >= b) break;
    let m = lo;
    for (let i = lo; i < Math.min(hi, b); i++) if (mono[i] > mono[m]) m = i;
    t = Math.max(m, t + 1);
  }
  if (marks.length < 3) return;

  const len = b - a;
  const acc = dst.map(() => new Float32Array(len));
  const wsum = new Float32Array(len);
  let ts = marks[0];
  let k = 0;
  while (ts < b) {
    while (k + 1 < marks.length && Math.abs(marks[k + 1] - ts) < Math.abs(marks[k] - ts)) k++;
    const m = marks[k];
    const p = Math.max(16, Math.round(period(m) || p0));
    for (let j = -p; j < p; j++) {
      const si = m + j;
      const di = Math.round(ts) + j;
      if (si < 0 || si >= src[0].length || di < a || di >= b) continue;
      const w = 0.5 * (1 + Math.cos((Math.PI * j) / p));
      for (let c = 0; c < src.length; c++) acc[c][di - a] += src[c][si] * w;
      wsum[di - a] += w;
    }
    const r = ratio[Math.min(ratio.length - 1, Math.round(ts))] || 1;
    ts += p / r;
  }
  // mistura com o original nas bordas (onde a razão é 1, fica o sinal original)
  for (let i = 0; i < len; i++) {
    const gi = a + i;
    const dev = Math.abs(ratio[gi] - 1);
    const wet = wsum[i] > 1e-3 ? Math.min(1, dev * 400) : 0;
    if (wet <= 0) continue;
    for (let c = 0; c < dst.length; c++) {
      const y = acc[c][i] / Math.max(wsum[i], 1e-3);
      dst[c][gi] = src[c][gi] * (1 - wet) + y * wet;
    }
  }
}
