/** Filtros e EQs: Butterworth em cascata de biquads + RBJ Audio EQ Cookbook (espelha o worker Python). */
import type { Signal } from "./types";

/** Coeficientes normalizados (a0 = 1): [b0, b1, b2, a1, a2]. */
export type Biquad = readonly [number, number, number, number, number];

const clampFreq = (f: number, sr: number) => Math.min(Math.max(f, 10), sr * 0.49);

function norm(b0: number, b1: number, b2: number, a0: number, a1: number, a2: number): Biquad {
  return [b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0];
}

/** Aplica biquads em cascata, in-place (forma direta II transposta, estado em float64). */
export function applySections(x: Float32Array, sections: readonly Biquad[]): void {
  for (const [b0, b1, b2, a1, a2] of sections) {
    let z1 = 0;
    let z2 = 0;
    for (let i = 0; i < x.length; i++) {
      const v = x[i];
      const y = b0 * v + z1;
      z1 = b1 * v - a1 * y + z2;
      z2 = b2 * v - a2 * y;
      x[i] = y;
    }
  }
}

export function applyToSignal(audio: Signal, sections: readonly Biquad[]): Signal {
  for (const ch of audio) applySections(ch, sections);
  return audio;
}

function firstOrder(type: "lp" | "hp", f: number, sr: number): Biquad {
  const k = Math.tan((Math.PI * f) / sr);
  const a1 = (k - 1) / (k + 1);
  return type === "lp" ? [k / (1 + k), k / (1 + k), 0, a1, 0] : [1 / (1 + k), -1 / (1 + k), 0, a1, 0];
}

function secondOrder(type: "lp" | "hp", f: number, q: number, sr: number): Biquad {
  const w0 = (2 * Math.PI * f) / sr;
  const cw = Math.cos(w0);
  const alpha = Math.sin(w0) / (2 * q);
  if (type === "lp") return norm((1 - cw) / 2, 1 - cw, (1 - cw) / 2, 1 + alpha, -2 * cw, 1 - alpha);
  return norm((1 + cw) / 2, -(1 + cw), (1 + cw) / 2, 1 + alpha, -2 * cw, 1 - alpha);
}

/** Q de cada seção de 2ª ordem de um Butterworth; ordens ímpares têm também uma seção de 1ª ordem. */
const BUTTER_Q: Record<number, { first: boolean; qs: number[] }> = {
  1: { first: true, qs: [] },
  2: { first: false, qs: [Math.SQRT1_2] },
  3: { first: true, qs: [1] },
  4: { first: false, qs: [0.5411961001461969, 1.3065629648763766] },
};

export function butterworth(type: "lp" | "hp", order: number, freq: number, sr: number): Biquad[] {
  const f = clampFreq(freq, sr);
  const spec = BUTTER_Q[order] ?? BUTTER_Q[2];
  const out: Biquad[] = [];
  if (spec.first) out.push(firstOrder(type, f, sr));
  for (const q of spec.qs) out.push(secondOrder(type, f, q, sr));
  return out;
}

const slopeToOrder = (slope: string) => ({ "6": 1, "12": 2, "18": 3, "24": 4 })[slope] ?? 2;

export function peakingBiquad(sr: number, freq: number, gainDb: number, q: number): Biquad {
  const a = 10 ** (gainDb / 40);
  const w0 = (2 * Math.PI * clampFreq(freq, sr)) / sr;
  const alpha = Math.sin(w0) / (2 * q);
  const cw = Math.cos(w0);
  return norm(1 + alpha * a, -2 * cw, 1 - alpha * a, 1 + alpha / a, -2 * cw, 1 - alpha / a);
}

export function shelfBiquad(sr: number, freq: number, gainDb: number, q: number, position: string): Biquad {
  const a = 10 ** (gainDb / 40);
  const w0 = (2 * Math.PI * clampFreq(freq, sr)) / sr;
  const alpha = Math.sin(w0) / (2 * q);
  const cw = Math.cos(w0);
  const sa = 2 * Math.sqrt(a) * alpha;
  if (position === "low") {
    return norm(
      a * (a + 1 - (a - 1) * cw + sa),
      2 * a * (a - 1 - (a + 1) * cw),
      a * (a + 1 - (a - 1) * cw - sa),
      a + 1 + (a - 1) * cw + sa,
      -2 * (a - 1 + (a + 1) * cw),
      a + 1 + (a - 1) * cw - sa,
    );
  }
  return norm(
    a * (a + 1 + (a - 1) * cw + sa),
    -2 * a * (a - 1 + (a + 1) * cw),
    a * (a + 1 + (a - 1) * cw - sa),
    a + 1 - (a - 1) * cw + sa,
    2 * (a - 1 - (a + 1) * cw),
    a + 1 - (a - 1) * cw - sa,
  );
}

export function highpass(audio: Signal, sr: number, p: { frequency_hz: number; slope_db_oct: string }): Signal {
  return applyToSignal(audio, butterworth("hp", slopeToOrder(p.slope_db_oct), p.frequency_hz, sr));
}

export function lowpass(audio: Signal, sr: number, p: { frequency_hz: number; slope_db_oct: string }): Signal {
  if (p.frequency_hz >= sr * 0.49) return audio;
  return applyToSignal(audio, butterworth("lp", slopeToOrder(p.slope_db_oct), p.frequency_hz, sr));
}

export function eqPeak(audio: Signal, sr: number, p: { frequency_hz: number; gain_db: number; q: number }): Signal {
  if (Math.abs(p.gain_db) < 1e-3) return audio;
  return applyToSignal(audio, [peakingBiquad(sr, p.frequency_hz, p.gain_db, p.q)]);
}

export function eqShelf(
  audio: Signal,
  sr: number,
  p: { position: string; frequency_hz: number; gain_db: number; q: number },
): Signal {
  if (Math.abs(p.gain_db) < 1e-3) return audio;
  return applyToSignal(audio, [shelfBiquad(sr, p.frequency_hz, p.gain_db, p.q, p.position)]);
}
