/** Pedais de guitarra/baixo: overdrive, chorus e oitavador. */
import { applySections, butterworth, peakingBiquad } from "./filters";
import { oversampled } from "./tone";
import type { Signal } from "./types";

/** Overdrive estilo "tubo verde": corta grave antes de distorcer, realça médios, clipping suave. */
export function overdrive(audio: Signal, sr: number, p: { drive: number; tone: number; level_db: number }): Signal {
  const d = Math.min(10, Math.max(0, p.drive)) / 10;
  if (d <= 0.001 && Math.abs(p.level_db) < 0.01) return audio;
  const gain = 10 ** ((6 + d * 30) / 20);
  const toneHz = 1500 + (Math.min(10, Math.max(0, p.tone)) / 10) * 5500;
  const level = 10 ** (p.level_db / 20);
  for (const ch of audio) {
    let inE = 0;
    for (let i = 0; i < ch.length; i += 2) inE += ch[i] * ch[i];
    const x = ch.slice();
    applySections(x, [...butterworth("hp", 1, 720, sr), peakingBiquad(sr, 900, 4, 0.7)]);
    oversampled(x, (v) => Math.tanh(gain * v) / Math.sqrt(gain));
    applySections(x, butterworth("lp", 2, toneHz, sr));
    // o grave cortado volta limpo por baixo (como no pedal original), mais baixo
    const low = ch.slice();
    applySections(low, butterworth("lp", 1, 720, sr));
    let outE = 0;
    for (let i = 0; i < x.length; i += 2) {
      const v = x[i] + low[i] * 0.3;
      outE += v * v;
    }
    const back = outE > 1e-12 ? Math.sqrt(inE / outE) : 1;
    for (let i = 0; i < ch.length; i++) ch[i] = (x[i] + low[i] * 0.3) * back * level;
  }
  return audio;
}

/** Chorus: duas vozes com atraso modulado (7–25 ms), uma em cada lado no estéreo. */
export function chorus(audio: Signal, sr: number, p: { rate_hz: number; depth: number; mix: number }): Signal {
  const m = Math.min(1, Math.max(0, p.mix / 100));
  if (m <= 0.001) return audio;
  const base = 0.012 * sr;
  const depth = (Math.min(100, Math.max(0, p.depth)) / 100) * 0.006 * sr;
  const w = (2 * Math.PI * p.rate_hz) / sr;
  const read = (x: Float32Array, pos: number) => {
    const i = Math.floor(pos);
    if (i < 0 || i + 1 >= x.length) return 0;
    const f = pos - i;
    return x[i] * (1 - f) + x[i + 1] * f;
  };
  const dry = audio.map((c) => c.slice());
  const src = dry.length === 2 ? dry.map((_, c) => dry[c]) : [dry[0], dry[0]];
  audio.forEach((ch, c) => {
    const phase = c === 0 ? 0 : Math.PI / 2;
    for (let i = 0; i < ch.length; i++) {
      const delay = base + depth * (1 + Math.sin(w * i + phase));
      ch[i] = dry[c][i] * (1 - m * 0.5) + read(src[c], i - delay) * m * 0.7;
    }
  });
  return audio;
}

/**
 * Oitavador analógico: um divisor de frequência troca de sinal a cada ciclo da nota (filtrada),
 * e isso modula a envoltória — uma oitava abaixo, como os pedais clássicos.
 */
export function octaver(audio: Signal, sr: number, p: { octave: number; dry: number; tone_hz: number }): Signal {
  const o = Math.min(1, Math.max(0, p.octave / 100));
  const dryG = Math.min(1, Math.max(0, p.dry / 100));
  if (o <= 0.001 && dryG >= 0.999) return audio;
  for (const ch of audio) {
    const track = ch.slice();
    applySections(track, [...butterworth("lp", 4, 400, sr), ...butterworth("hp", 2, 30, sr)]);
    const out = new Float32Array(ch.length);
    let flip = 1;
    let prev = 0;
    let env = 0;
    const att = Math.exp(-1 / (0.002 * sr));
    const rel = Math.exp(-1 / (0.03 * sr));
    for (let i = 0; i < ch.length; i++) {
      const v = track[i];
      // troca a cada ciclo da nota → a onda quadrada tem metade da frequência
      if (prev <= 0 && v > 0) flip = -flip;
      prev = v;
      const a = Math.abs(v);
      env = a > env ? att * env + (1 - att) * a : rel * env + (1 - rel) * a;
      out[i] = flip * env;
    }
    applySections(out, [...butterworth("lp", 2, p.tone_hz, sr), ...butterworth("hp", 1, 25, sr)]);
    for (let i = 0; i < ch.length; i++) ch[i] = ch[i] * dryG + out[i] * o * 1.6;
  }
  return audio;
}
