/**
 * Kits de estúdio: bumbo, caixa e tons gerados por síntese (varredura de afinação, transiente
 * de pele, ressonância e esteira filtrada). Um "sabor" por estilo, na linha dos kits de
 * bibliotecas profissionais (bumbo com ataque e grave de estúdio, caixa encorpada ou seca…).
 */
import { applySections, butterworth } from "../filters";

export type KitId = "worship" | "poprock" | "reggae" | "groove" | "soul" | "gospel" | "sertanejo";

type KickSpec = { fStart: number; fEnd: number; pitchDecay: number; decay: number; click: number; sub: number; drive: number };
type SnareSpec = { tone: number; toneDecay: number; noiseDecay: number; hp: number; lp: number; toneMix: number; crack: number };
type TomSpec = { decay: number; drive: number };

export type Kit = { kick: KickSpec; snare: SnareSpec; tom: TomSpec; roomSize: number; roomDamping: number };

export const KITS: Record<KitId, Kit> = {
  // grave profundo e longo, caixa gorda, muita sala (baterias de louvor contemporâneo)
  worship: {
    kick: { fStart: 115, fEnd: 47, pitchDecay: 0.045, decay: 0.42, click: 0.25, sub: 0.55, drive: 1.3 },
    snare: { tone: 178, toneDecay: 0.12, noiseDecay: 0.26, hp: 1300, lp: 7500, toneMix: 0.5, crack: 0.25 },
    tom: { decay: 0.55, drive: 1.2 },
    roomSize: 82,
    roomDamping: 45,
  },
  // bumbo com ataque que corta, caixa estalada e brilhante
  poprock: {
    kick: { fStart: 140, fEnd: 55, pitchDecay: 0.03, decay: 0.3, click: 0.6, sub: 0.35, drive: 1.8 },
    snare: { tone: 205, toneDecay: 0.09, noiseDecay: 0.19, hp: 1800, lp: 10000, toneMix: 0.38, crack: 0.55 },
    tom: { decay: 0.4, drive: 1.6 },
    roomSize: 55,
    roomDamping: 50,
  },
  // bumbo redondo e macio, caixa aguda e curta ("timbal"), quase sem sala
  reggae: {
    kick: { fStart: 100, fEnd: 50, pitchDecay: 0.05, decay: 0.36, click: 0.12, sub: 0.5, drive: 1.1 },
    snare: { tone: 320, toneDecay: 0.07, noiseDecay: 0.09, hp: 2200, lp: 9000, toneMix: 0.55, crack: 0.7 },
    tom: { decay: 0.3, drive: 1.2 },
    roomSize: 25,
    roomDamping: 60,
  },
  // seco e curto, ataque rápido: groove, funk, black
  groove: {
    kick: { fStart: 125, fEnd: 60, pitchDecay: 0.025, decay: 0.19, click: 0.5, sub: 0.25, drive: 1.5 },
    snare: { tone: 232, toneDecay: 0.06, noiseDecay: 0.12, hp: 2000, lp: 11000, toneMix: 0.35, crack: 0.65 },
    tom: { decay: 0.28, drive: 1.4 },
    roomSize: 20,
    roomDamping: 65,
  },
  // vintage: grave quente sem clique, caixa grave e escura
  soul: {
    kick: { fStart: 92, fEnd: 52, pitchDecay: 0.04, decay: 0.26, click: 0.05, sub: 0.4, drive: 2.2 },
    snare: { tone: 186, toneDecay: 0.1, noiseDecay: 0.2, hp: 1100, lp: 5800, toneMix: 0.55, crack: 0.15 },
    tom: { decay: 0.4, drive: 2 },
    roomSize: 40,
    roomDamping: 70,
  },
  // bumbo com punch, caixa aguda e estalada, energia alta
  gospel: {
    kick: { fStart: 145, fEnd: 54, pitchDecay: 0.028, decay: 0.28, click: 0.55, sub: 0.4, drive: 1.8 },
    snare: { tone: 245, toneDecay: 0.07, noiseDecay: 0.16, hp: 2000, lp: 11000, toneMix: 0.35, crack: 0.7 },
    tom: { decay: 0.38, drive: 1.6 },
    roomSize: 45,
    roomDamping: 50,
  },
  // bumbo definido, caixa média com corpo: pop sertanejo de estúdio
  sertanejo: {
    kick: { fStart: 125, fEnd: 52, pitchDecay: 0.035, decay: 0.32, click: 0.4, sub: 0.45, drive: 1.6 },
    snare: { tone: 212, toneDecay: 0.09, noiseDecay: 0.18, hp: 1600, lp: 9000, toneMix: 0.42, crack: 0.45 },
    tom: { decay: 0.45, drive: 1.5 },
    roomSize: 50,
    roomDamping: 55,
  },
};

function noiseSource(seed: number) {
  let s = seed;
  return () => ((s = (s * 16807) % 2147483647) / 2147483647) * 2 - 1;
}

function normalize(x: Float32Array<ArrayBuffer>): Float32Array<ArrayBuffer> {
  let p = 0;
  for (const v of x) p = Math.max(p, Math.abs(v));
  if (p > 0) for (let i = 0; i < x.length; i++) x[i] /= p;
  return x;
}

export function kickSample(sr: number, k: KickSpec): Float32Array<ArrayBuffer> {
  const n = Math.round(sr * Math.min(1.5, k.decay * 4));
  const out = new Float32Array(n);
  const rnd = noiseSource(7);
  const click = new Float32Array(Math.round(sr * 0.012));
  for (let i = 0; i < click.length; i++) click[i] = rnd() * Math.exp(-i / (sr * 0.0015));
  applySections(click, butterworth("hp", 2, 3000, sr));
  let phase = 0;
  const tanhK = Math.tanh(k.drive);
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const f = k.fEnd + (k.fStart - k.fEnd) * Math.exp(-t / k.pitchDecay);
    phase += (2 * Math.PI * f) / sr;
    const attack = Math.min(1, i / (sr * 0.0008));
    const body = Math.sin(phase) * Math.exp(-t / k.decay) * attack;
    const sub = Math.sin(2 * Math.PI * k.fEnd * t) * Math.exp(-t / (k.decay * 1.3)) * k.sub * attack;
    const cl = i < click.length ? click[i] * k.click * 3 : 0;
    out[i] = Math.tanh(k.drive * (body + sub + cl)) / tanhK;
  }
  return normalize(out);
}

export function snareSample(sr: number, s: SnareSpec): Float32Array<ArrayBuffer> {
  const n = Math.round(sr * Math.min(1.2, Math.max(s.noiseDecay, s.toneDecay) * 5));
  const rnd = noiseSource(11);
  const noise = new Float32Array(n);
  for (let i = 0; i < n; i++) noise[i] = rnd() * Math.exp(-i / (sr * s.noiseDecay));
  applySections(noise, [...butterworth("hp", 2, s.hp, sr), ...butterworth("lp", 2, s.lp, sr)]);
  const crack = new Float32Array(n);
  for (let i = 0; i < Math.min(n, sr * 0.02); i++) crack[i] = rnd() * Math.exp(-i / (sr * 0.003));
  applySections(crack, butterworth("hp", 2, 2500, sr));
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const drop = 1 - 0.04 * (1 - Math.exp(-t / 0.02));
    const tone =
      Math.sin(2 * Math.PI * s.tone * drop * t) * Math.exp(-t / s.toneDecay) +
      0.45 * Math.sin(2 * Math.PI * s.tone * 1.59 * t) * Math.exp(-t / (s.toneDecay * 0.6));
    const attack = Math.min(1, i / (sr * 0.0005));
    out[i] = attack * (tone * s.toneMix + noise[i] * 2.2 * (1 - s.toneMix)) + crack[i] * s.crack * 1.5;
  }
  return normalize(out);
}

/** Tom afinado na frequência detectada (padrão entre 90 e 200 Hz). */
export function tomSample(sr: number, t: TomSpec, freq: number): Float32Array<ArrayBuffer> {
  const n = Math.round(sr * Math.min(1.5, t.decay * 4));
  const rnd = noiseSource(13);
  const out = new Float32Array(n);
  let phase = 0;
  const tanhK = Math.tanh(t.drive);
  for (let i = 0; i < n; i++) {
    const s = i / sr;
    const f = freq * (1 + 0.22 * Math.exp(-s / 0.05));
    phase += (2 * Math.PI * f) / sr;
    const attack = Math.min(1, i / (sr * 0.0008));
    const skin = s < 0.01 ? rnd() * Math.exp(-s / 0.002) * 0.4 : 0;
    out[i] = Math.tanh(t.drive * (Math.sin(phase) * Math.exp(-s / t.decay) * attack + skin)) / tanhK;
  }
  return normalize(out);
}
