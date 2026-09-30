/**
 * Vídeo "antes → depois" para as redes: o começo toca o som original do celular e, na virada,
 * entra o som tratado. O original é igualado em volume ao tratado (a diferença que se ouve é de
 * qualidade, não de volume) e a troca tem um crossfade curto.
 */
import { integratedLoudness, samplePeak } from "@/lib/dsp/loudness";
import type { Signal } from "@/lib/dsp/types";
import { keptDuration, type Segment } from "./cuts";

/** Momento da virada em segundos do arquivo final: 40% do vídeo, entre 2,5 s e 10 s. */
export function splitOutputTime(duration: number): number {
  return Math.max(Math.min(2.5, duration / 2), Math.min(10, duration * 0.4, duration - 2));
}

/** Converte tempo do arquivo final (depois dos cortes) para tempo do original. */
export function outputToSource(segments: Segment[], tOut: number): number {
  let acc = 0;
  for (const s of segments) {
    const len = s.end - s.start;
    if (tOut <= acc + len) return s.start + (tOut - acc);
    acc += len;
  }
  return segments[segments.length - 1]?.end ?? tOut;
}

export function beforeAfterAudio(
  original: Signal,
  processed: Signal,
  sr: number,
  audioStart: number,
  segments: Segment[],
): { audio: Signal; split: number } {
  const split = outputToSource(segments, splitOutputTime(keptDuration(segments)));
  const at = Math.max(0, Math.min(processed[0].length, Math.round((split - audioStart) * sr)));
  const lo = integratedLoudness(original, sr);
  const lp = integratedLoudness(processed, sr);
  let g = Number.isFinite(lo) && Number.isFinite(lp) ? 10 ** (Math.max(-12, Math.min(12, lp - lo)) / 20) : 1;
  // sem clipar o original ao subir o volume
  const peak = samplePeak(original) * g;
  if (peak > 0.95) g *= 0.95 / peak;
  const fade = Math.min(Math.round(sr * 0.06), at);
  const audio = processed.map((p, c) => {
    const o = original[Math.min(c, original.length - 1)];
    const out = p.slice();
    for (let i = 0; i < at; i++) {
      const k = i >= at - fade ? (at - i) / Math.max(1, fade) : 1; // 1 → 0 no fim do "antes"
      out[i] = o[i] * g * k + p[i] * (1 - k);
    }
    return out;
  });
  return { audio, split };
}
