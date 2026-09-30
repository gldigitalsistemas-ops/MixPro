/** Ganho, saturação (oversampling 2x), soft clip e normalização. */
import { applySections, butterworth } from "./filters";
import { integratedLoudness, samplePeak } from "./loudness";
import { dbToGain, type Signal } from "./types";

export function gain(audio: Signal, _sr: number, p: { gain_db: number }): Signal {
  if (Math.abs(p.gain_db) < 1e-4) return audio;
  const g = dbToGain(p.gain_db);
  for (const ch of audio) for (let i = 0; i < ch.length; i++) ch[i] *= g;
  return audio;
}

// ---------------------------------------------------------------------------
// Reamostragem polifásica 2x (FIR Kaiser β=5, meia-banda)
// ---------------------------------------------------------------------------
const L = 2;
const HALF = 8 * L;
const TAPS = 2 * HALF + 1;

function besselI0(x: number): number {
  let sum = 1;
  let term = 1;
  for (let k = 1; k < 50; k++) {
    term *= (x / (2 * k)) ** 2;
    sum += term;
    if (term < 1e-12 * sum) break;
  }
  return sum;
}

const FIR: Float64Array = (() => {
  const h = new Float64Array(TAPS);
  const beta = 5;
  const fc = 0.5 / L;
  const i0b = besselI0(beta);
  let sum = 0;
  for (let k = 0; k < TAPS; k++) {
    const t = k - HALF;
    const sinc = t === 0 ? 2 * fc : Math.sin(2 * Math.PI * fc * t) / (Math.PI * t);
    const r = t / HALF;
    h[k] = sinc * (besselI0(beta * Math.sqrt(Math.max(0, 1 - r * r))) / i0b);
    sum += h[k];
  }
  for (let k = 0; k < TAPS; k++) h[k] /= sum;
  return h;
})();

/** Sub-filtros por fase, já multiplicados por L (ganho da interpolação). */
const PHASES: Float64Array[] = Array.from({ length: L }, (_, ph) => {
  const taps: number[] = [];
  for (let k = ph; k < TAPS; k += L) taps.push(FIR[k] * L);
  return Float64Array.from(taps);
});
const PAD_IN = Math.ceil(TAPS / L) + 1;

/** Aplica `curve` com oversampling 2x no canal (in-place), sem atraso. */
export function oversampled(x: Float32Array, curve: (v: number) => number): void {
  const n = x.length;
  const xp = new Float64Array(n + 2 * PAD_IN);
  xp.set(x, PAD_IN);
  // `up` guarda HALF zeros de cada lado para a decimação não precisar checar limites
  const up = new Float64Array(n * L + 2 * HALF);
  const shift = HALF / L + PAD_IN;
  for (let r = 0; r < L; r++) {
    const taps = PHASES[r];
    const nt = taps.length;
    for (let j = 0; j < n; j++) {
      const j0 = j + shift;
      let s = 0;
      for (let t = 0; t < nt; t++) s += taps[t] * xp[j0 - t];
      up[j * L + r + HALF] = curve(s);
    }
  }
  for (let j = 0; j < n; j++) {
    const base = j * L + 2 * HALF;
    let s = 0;
    for (let k = 0; k < TAPS; k++) s += FIR[k] * up[base - k];
    x[j] = s;
  }
}

export function saturation(
  audio: Signal,
  sr: number,
  p: { mode: string; drive_db: number; mix: number; output_db: number },
): Signal {
  const m = Math.min(Math.max(p.mix / 100, 0), 1);
  if (m <= 1e-4) return gain(audio, sr, { gain_db: p.output_db });
  const g = dbToGain(p.drive_db);
  let curve: (v: number) => number;
  if (p.mode === "tube") {
    const bias = 0.25;
    const tb = Math.tanh(bias);
    const normK = g * (1 - tb * tb);
    curve = (v) => (Math.tanh(g * v + bias) - tb) / normK;
  } else if (p.mode === "hard") {
    curve = (v) => Math.max(-1, Math.min(1, g * v)) / g;
  } else {
    curve = (v) => Math.tanh(g * v) / g;
  }
  const dc = p.mode === "tube" ? butterworth("hp", 1, 5, sr) : null;
  for (const ch of audio) {
    const wet = ch.slice();
    oversampled(wet, curve);
    if (dc) applySections(wet, dc);
    for (let i = 0; i < ch.length; i++) ch[i] = ch[i] * (1 - m) + wet[i] * m;
  }
  return gain(audio, sr, { gain_db: p.output_db });
}

export function softClip(audio: Signal, _sr: number, p: { ceiling_db: number; input_gain_db: number }): Signal {
  const c = dbToGain(p.ceiling_db);
  const g = dbToGain(p.input_gain_db);
  for (const ch of audio) {
    oversampled(ch, (v) => c * Math.tanh((g * v) / c));
    for (let i = 0; i < ch.length; i++) ch[i] = Math.max(-c, Math.min(c, ch[i]));
  }
  return audio;
}

export function normalize(audio: Signal, sr: number, p: { mode: string; target_db: number }): Signal {
  if (p.mode === "peak") {
    const peak = samplePeak(audio);
    if (peak <= 1e-9) return audio;
    return gain(audio, sr, { gain_db: p.target_db - 20 * Math.log10(peak) });
  }
  const lufs = integratedLoudness(audio, sr);
  if (!Number.isFinite(lufs)) return audio;
  return gain(audio, sr, { gain_db: p.target_db - lufs });
}
