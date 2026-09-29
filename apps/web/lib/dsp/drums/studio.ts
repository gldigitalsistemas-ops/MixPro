/**
 * Módulo "Bateria de estúdio": reforço de peças (a técnica de "trigger" dos estúdios).
 * Cada bumbo/caixa/tom detectado recebe o timbre do estilo, na mesma força da batida original;
 * pratos e ambiência vêm da própria gravação. Depois a cadeia do preset faz EQ, compressão e sala.
 */
import { applySections, butterworth, shelfBiquad } from "../filters";
import { reverb } from "../space";
import type { Signal } from "../types";
import { detectDrums, type Piece } from "./detect";
import { KITS, kickSample, snareSample, tomSample, type KitId } from "./kits";

type Params = {
  kit: string;
  sample_mix: number;
  kick: number;
  snare: number;
  toms: number;
  cymbals: number;
  room: number;
};

const LEVEL: Record<Exclude<Piece, "cymbal">, number> = { kick: 1, snare: 0.9, tom: 0.8 };

/** Afinação do tom pela autocorrelação do grave logo após o ataque (70–250 Hz). */
function tomPitch(x: Float32Array, at: number, sr: number): number {
  const len = Math.round(sr * 0.04);
  const start = at + Math.round(sr * 0.01);
  if (start + len * 2 >= x.length) return 120;
  let bestLag = 0;
  let best = 0;
  for (let lag = Math.round(sr / 250); lag <= Math.round(sr / 70); lag++) {
    let s = 0;
    for (let i = 0; i < len; i += 2) s += x[start + i] * x[start + i + lag];
    if (s > best) {
      best = s;
      bestLag = lag;
    }
  }
  return bestLag ? Math.min(250, Math.max(70, sr / bestLag)) : 120;
}

function refPeak(x: Float32Array): number {
  const vals: number[] = [];
  for (let i = 0; i < x.length; i += 16) vals.push(Math.abs(x[i]));
  vals.sort((a, b) => a - b);
  return vals[Math.floor(vals.length * 0.995)] || 0.3;
}

export function drumStudio(audio: Signal, sr: number, p: Params): Signal {
  const mix = Math.min(1, Math.max(0, p.sample_mix / 100));
  const kit = KITS[(p.kit as KitId) in KITS ? (p.kit as KitId) : "poprock"];
  const n = audio[0].length;

  // pratos: realce/atenuação do brilho da gravação original
  if (Math.abs(p.cymbals) > 0.05) {
    const shelf = [shelfBiquad(sr, 7000, p.cymbals, 0.707, "high")];
    for (const ch of audio) applySections(ch, shelf);
  }
  if (mix <= 0.001) return audio;

  const { hits } = detectDrums(audio, sr);
  const mono = new Float32Array(n);
  for (const ch of audio) for (let i = 0; i < n; i++) mono[i] += ch[i] / audio.length;
  const peak = refPeak(mono);
  const lowForPitch = mono.slice();
  applySections(lowForPitch, butterworth("lp", 2, 300, sr));

  const kick = kickSample(sr, kit.kick);
  const snare = snareSample(sr, kit.snare);
  const tomCache = new Map<number, Float32Array>();
  const gainDb: Record<Exclude<Piece, "cymbal">, number> = { kick: p.kick, snare: p.snare, tom: p.toms };

  const reinf = new Float32Array(n);
  for (const h of hits) {
    if (h.piece === "cymbal") continue;
    let smp: Float32Array;
    if (h.piece === "kick") smp = kick;
    else if (h.piece === "snare") smp = snare;
    else {
      const f = Math.round(tomPitch(lowForPitch, h.sample, sr) / 5) * 5;
      if (!tomCache.has(f)) tomCache.set(f, tomSample(sr, kit.tom, f));
      smp = tomCache.get(f)!;
    }
    const g = peak * Math.min(1.2, h.velocity) * LEVEL[h.piece] * 10 ** (gainDb[h.piece] / 20);
    const start = Math.max(0, h.sample - Math.round(sr * 0.001));
    const len = Math.min(smp.length, n - start);
    for (let i = 0; i < len; i++) reinf[start + i] += smp[i] * g;
  }

  // sala do estilo aplicada só ao reforço (a gravação já tem a sua ambiência)
  let wet: Signal = audio.map(() => reinf.slice());
  if (p.room > 0.5) {
    wet = reverb(wet, sr, {
      room_size: kit.roomSize,
      damping: kit.roomDamping,
      width: 100,
      predelay_ms: 12,
      mix: Math.min(60, p.room * 0.45),
    });
  }

  const keep = 1 - 0.35 * mix;
  return audio.map((ch, c) => {
    const w = wet[c];
    for (let i = 0; i < n; i++) ch[i] = ch[i] * keep + w[i] * mix;
    return ch;
  });
}
