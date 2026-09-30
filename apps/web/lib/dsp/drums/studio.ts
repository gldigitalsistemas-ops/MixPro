/**
 * Módulo "Bateria de estúdio": reforço dos tambores (a técnica de "trigger" dos estúdios).
 * Cada bumbo, caixa, tom e surdo detectado dispara o sample escolhido (gravações reais de bateria
 * vindas da biblioteca do admin), na mesma força da batida. Pratos e chimbal ficam como foram
 * gravados. Sem sample escolhido, usa o timbre sintetizado do estilo.
 */
import { applySections, butterworth } from "../filters";
import { resample } from "../resample";
import { reverb } from "../space";
import type { Signal } from "../types";
import { detectDrums, type Hit } from "./detect";
import { KITS, kickSample, snareSample, tomSample, type KitId } from "./kits";

export type DrumSlot = "kick" | "snare" | "tom1" | "tom2" | "floor" | "rimshot";
export const DRUM_SLOTS: DrumSlot[] = ["kick", "snare", "tom1", "tom2", "floor", "rimshot"];

/**
 * Camadas de cada peça (mono, da batida mais leve para a mais forte) e, opcionalmente, as mesmas
 * batidas gravadas pelos microfones de sala (`rooms`, mesma ordem).
 */
export type DrumSampleSet = Partial<Record<DrumSlot, Float32Array[]>> & { rooms?: Partial<Record<DrumSlot, Float32Array[]>> };

let SAMPLES: DrumSampleSet = {};

/** Samples carregados pelo app para esta execução (o worker recebe junto com o áudio). */
export function setDrumSamples(set: DrumSampleSet | null | undefined) {
  SAMPLES = set ?? {};
}

type Params = {
  kit: string;
  sample_mix: number;
  kick: number;
  snare: number;
  toms: number;
  floor: number;
  kick_tune: number;
  snare_tune: number;
  toms_tune: number;
  floor_tune: number;
  rimshot: number;
  room: number;
  reverb_size: string;
  reverb: number;
};

const LEVEL: Record<DrumSlot, number> = { kick: 1, snare: 0.9, tom1: 0.8, tom2: 0.8, floor: 0.85, rimshot: 0.9 };

const tuned = new WeakMap<Float32Array, Map<number, Float32Array>>();

/** Afina o sample (semitons): tocar mais rápido sobe a nota e encurta, como afinar a pele. */
export function tuneSample(x: Float32Array<ArrayBuffer>, semitones: number, sr: number): Float32Array {
  if (Math.abs(semitones) < 0.01) return x;
  let byTune = tuned.get(x);
  if (!byTune) tuned.set(x, (byTune = new Map()));
  let y = byTune.get(semitones);
  if (!y) {
    y = resample(x, Math.round(sr * 2 ** (semitones / 12)), sr);
    byTune.set(semitones, y);
  }
  return y;
}

export const REVERB_SIZES: Record<string, { room: number; damping: number; predelay: number }> = {
  small: { room: 35, damping: 60, predelay: 4 },
  medium: { room: 62, damping: 50, predelay: 12 },
  large: { room: 86, damping: 38, predelay: 24 },
};

/** Afinação do tom pela autocorrelação do grave logo após o ataque (60–250 Hz). */
function tomPitch(x: Float32Array, at: number, sr: number): number {
  const len = Math.round(sr * 0.04);
  const start = at + Math.round(sr * 0.01);
  if (start + len * 2 >= x.length) return 120;
  let bestLag = 0;
  let best = 0;
  for (let lag = Math.round(sr / 250); lag <= Math.round(sr / 60); lag++) {
    let s = 0;
    for (let i = 0; i < len; i += 2) s += x[start + i] * x[start + i + lag];
    if (s > best) {
      best = s;
      bestLag = lag;
    }
  }
  return bestLag ? Math.min(250, Math.max(60, sr / bestLag)) : 120;
}

/**
 * Separa os tons pela afinação: o grupo mais agudo é o tom 1, o mais grave é o surdo
 * (quando é grave de verdade ou quando há três ou mais afinações), o do meio é o tom 2.
 */
export function assignTomSlots(pitches: number[]): ("tom1" | "tom2" | "floor")[] {
  if (!pitches.length) return [];
  const order = pitches.map((p, i) => ({ p, i })).sort((a, b) => b.p - a.p);
  const groups: { i: number[]; p: number }[] = [];
  for (const o of order) {
    const g = groups[groups.length - 1];
    if (g && g.p / o.p < 1.12) g.i.push(o.i);
    else groups.push({ i: [o.i], p: o.p });
  }
  const out: ("tom1" | "tom2" | "floor")[] = new Array(pitches.length);
  groups.forEach((g, k) => {
    let slot: "tom1" | "tom2" | "floor";
    if (groups.length === 1) slot = g.p < 95 ? "floor" : "tom1";
    else if (k === 0) slot = "tom1";
    else if (k === groups.length - 1 && (groups.length >= 3 || g.p < 110)) slot = "floor";
    else slot = "tom2";
    for (const i of g.i) out[i] = slot;
  });
  return out;
}

export type SlotHit = { slot: DrumSlot; sample: number; velocity: number; pitch?: number };

/** Tambores detectados, já com o tom separado em tom 1, tom 2 e surdo. */
export function analyzeDrums(audio: Signal, sr: number): { hits: SlotHit[]; counts: Record<DrumSlot, number> } {
  const { hits } = detectDrums(audio, sr);
  const n = audio[0].length;
  const mono = new Float32Array(n);
  for (const ch of audio) for (let i = 0; i < n; i++) mono[i] += ch[i] / audio.length;
  applySections(mono, butterworth("lp", 2, 300, sr));

  const toms = hits.filter((h) => h.piece === "tom");
  const pitches = toms.map((h) => tomPitch(mono, h.sample, sr));
  const slots = assignTomSlots(pitches);
  const tomSlot = new Map<Hit, { slot: DrumSlot; pitch: number }>(toms.map((h, i) => [h, { slot: slots[i], pitch: pitches[i] }]));

  const out: SlotHit[] = [];
  for (const h of hits) {
    if (h.piece === "cymbal") continue;
    const t = tomSlot.get(h);
    out.push(t ? { slot: t.slot, sample: h.sample, velocity: h.velocity, pitch: t.pitch } : { slot: h.piece as DrumSlot, sample: h.sample, velocity: h.velocity });
  }
  const counts = { kick: 0, snare: 0, tom1: 0, tom2: 0, floor: 0, rimshot: 0 } as Record<DrumSlot, number>;
  for (const h of out) counts[h.slot]++;
  return { hits: out, counts };
}

function refPeak(x: Float32Array): number {
  const vals: number[] = [];
  for (let i = 0; i < x.length; i += 16) vals.push(Math.abs(x[i]));
  vals.sort((a, b) => a - b);
  return vals[Math.floor(vals.length * 0.995)] || 0.3;
}

/** Camada pela força da batida, alternando com a vizinha (evita o som de "metralhadora"). */
function layerIndex(count: number, velocity: number, turn: number): number {
  const v = Math.min(1, Math.max(0, (velocity - 0.2) / 0.9));
  let idx = Math.round(v * (count - 1));
  if (count > 1 && turn % 2 === 1) idx = idx > 0 ? idx - 1 : idx + 1;
  return idx;
}

/** Caixas mais fortes (a fração `share` do topo) viram rimshot. */
function rimshotCut(hits: SlotHit[], share: number): number {
  if (share <= 0) return Infinity;
  const v = hits.filter((h) => h.slot === "snare").map((h) => h.velocity).sort((a, b) => b - a);
  if (!v.length) return Infinity;
  return v[Math.min(v.length - 1, Math.max(0, Math.ceil(v.length * Math.min(1, share)) - 1))];
}

export function drumStudio(audio: Signal, sr: number, p: Params): Signal {
  const mix = Math.min(1, Math.max(0, p.sample_mix / 100));
  const kit = KITS[(p.kit as KitId) in KITS ? (p.kit as KitId) : "poprock"];
  const n = audio[0].length;
  const reinf = new Float32Array(n);
  const roomBus = new Float32Array(n);
  let hasRoom = false;

  if (mix > 0.001) {
    const { hits } = analyzeDrums(audio, sr);
    const mono = new Float32Array(n);
    for (const ch of audio) for (let i = 0; i < n; i++) mono[i] += ch[i] / audio.length;
    const peak = refPeak(mono);

    const synthKick = SAMPLES.kick?.length ? null : kickSample(sr, kit.kick);
    const synthSnare = SAMPLES.snare?.length ? null : snareSample(sr, kit.snare);
    const tomCache = new Map<number, Float32Array>();
    const gainDb: Record<DrumSlot, number> = { kick: p.kick, snare: p.snare, tom1: p.toms, tom2: p.toms, floor: p.floor, rimshot: p.snare };
    const tune: Record<DrumSlot, number> = {
      kick: p.kick_tune,
      snare: p.snare_tune,
      tom1: p.toms_tune,
      tom2: p.toms_tune,
      floor: p.floor_tune,
      rimshot: p.snare_tune,
    };
    const turns: Record<DrumSlot, number> = { kick: 0, snare: 0, tom1: 0, tom2: 0, floor: 0, rimshot: 0 };
    const rimCut = SAMPLES.rimshot?.length ? rimshotCut(hits, p.rimshot / 100) : Infinity;

    const place = (bus: Float32Array, smp: Float32Array, start: number, g: number) => {
      const len = Math.min(smp.length, n - start);
      for (let i = 0; i < len; i++) bus[start + i] += smp[i] * g;
    };

    for (const hit of hits) {
      const slot: DrumSlot = hit.slot === "snare" && hit.velocity >= rimCut ? "rimshot" : hit.slot;
      const layers = SAMPLES[slot];
      const start = Math.max(0, hit.sample - Math.round(sr * 0.001));
      const g = peak * Math.min(1.2, hit.velocity) * LEVEL[slot] * 10 ** (gainDb[slot] / 20);
      let smp: Float32Array;
      if (layers?.length) {
        const idx = layerIndex(layers.length, hit.velocity, turns[slot]++);
        smp = tuneSample(layers[idx] as Float32Array<ArrayBuffer>, tune[slot], sr);
        const rooms = SAMPLES.rooms?.[slot];
        if (rooms?.length) {
          const r = rooms[Math.min(idx, rooms.length - 1)] as Float32Array<ArrayBuffer>;
          place(roomBus, tuneSample(r, tune[slot], sr), start, g);
          hasRoom = true;
        }
      } else if (slot === "kick") smp = tuneSample(synthKick as Float32Array<ArrayBuffer>, tune.kick, sr);
      else if (slot === "snare") smp = tuneSample(synthSnare as Float32Array<ArrayBuffer>, tune.snare, sr);
      else {
        const f = Math.round(((hit.pitch ?? 120) * 2 ** (tune[slot] / 12)) / 5) * 5;
        if (!tomCache.has(f)) tomCache.set(f, tomSample(sr, kit.tom, f));
        smp = tomCache.get(f)!;
      }
      place(reinf, smp, start, g);
    }
  }

  // mistura: a gravação continua por baixo (pratos, chimbal e a sala real) e os samples dão o corpo
  const keep = 1 - 0.45 * mix;
  const roomG = hasRoom ? Math.min(1, Math.max(0, p.room / 100)) : 0;
  const out = audio.map((ch) => {
    for (let i = 0; i < n; i++) ch[i] = ch[i] * keep + (reinf[i] + roomBus[i] * roomG) * mix;
    return ch;
  });

  // reverb escolhido pelo usuário: recebe os tambores reforçados inteiros e um pouco da gravação
  const amount = Math.min(1, Math.max(0, p.reverb / 100));
  if (amount > 0.005) {
    const size = REVERB_SIZES[p.reverb_size] ?? REVERB_SIZES.medium;
    const send: Signal = out.map((ch) => {
      const s = new Float32Array(n);
      for (let i = 0; i < n; i++) s[i] = reinf[i] * mix + ch[i] * 0.3;
      return s;
    });
    // tira o grave do envio: reverb embola o bumbo
    for (const s of send) applySections(s, butterworth("hp", 2, 180, sr));
    const wet = reverb(send, sr, { room_size: size.room, damping: size.damping, width: 100, predelay_ms: size.predelay, mix: 100 });
    const w = amount * 0.7;
    out.forEach((ch, c) => {
      for (let i = 0; i < n; i++) ch[i] += wet[c][i] * w;
    });
  }
  return out;
}
