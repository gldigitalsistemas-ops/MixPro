/**
 * Trechos de prévia e vitrine: o melhor trecho (o de mais energia, ex.: o refrão) com o "antes" no mesmo
 * volume percebido do "depois" — a comparação mostra a diferença de som, não de volume.
 */
import { integratedLoudness } from "@/lib/dsp/loudness";
import type { Signal } from "@/lib/dsp/types";

/** Início (em amostras) da janela de `seconds` com mais energia, passos de 1 s. */
export function loudestWindow(x: Signal, sr: number, seconds: number): number {
  const n = x[0]?.length ?? 0;
  const w = Math.round(seconds * sr);
  if (n <= w) return 0;
  const step = sr;
  // energia por segundo, depois soma deslizante
  const secs = Math.ceil(n / step);
  const e = new Float64Array(secs);
  for (const ch of x) for (let i = 0; i < n; i += 4) e[Math.floor(i / step)] += ch[i] * ch[i];
  const span = Math.round(seconds);
  let best = 0;
  let bestE = -1;
  let run = 0;
  for (let s = 0; s < secs; s++) {
    run += e[s];
    if (s >= span) run -= e[s - span];
    if (s >= span - 1 && run > bestE) {
      bestE = run;
      best = s - span + 1;
    }
  }
  return Math.min(best * step, n - w);
}

/** Recorta [start, start+len) com fade de 50 ms nas pontas. */
export function cut(x: Signal, sr: number, start: number, seconds: number): Signal {
  const len = Math.min(Math.round(seconds * sr), (x[0]?.length ?? 0) - start);
  const fade = Math.round(0.05 * sr);
  return x.map((ch) => {
    const out = ch.slice(start, start + len);
    for (let i = 0; i < fade && i < out.length; i++) {
      const g = i / fade;
      out[i] *= g;
      out[out.length - 1 - i] *= g;
    }
    return out;
  }) as Signal;
}

/** Ajusta o volume de `x` para a mesma loudness de `ref` (no máximo +12 dB; o pico fica abaixo de 0 dBFS). */
export function matchLoudness(x: Signal, sr: number, ref: Signal): Signal {
  const a = integratedLoudness(x, sr);
  const b = integratedLoudness(ref, sr);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return x;
  let g = 10 ** (Math.min(12, b - a) / 20);
  let peak = 0;
  for (const ch of x) for (let i = 0; i < ch.length; i++) peak = Math.max(peak, Math.abs(ch[i]));
  if (peak * g > 0.98) g = 0.98 / peak;
  for (const ch of x) for (let i = 0; i < ch.length; i++) ch[i] *= g;
  return x;
}

/** Soma simples das pistas (o "antes" de uma mixagem): mesmo ganho, centro, sem tratamento. */
export function roughMix(tracks: Signal[], n: number): Signal {
  const out = [new Float32Array(n), new Float32Array(n)] as Signal;
  for (const t of tracks) for (let c = 0; c < 2; c++) {
    const src = t[Math.min(c, t.length - 1)];
    for (let i = 0; i < n && i < src.length; i++) out[c][i] += src[i];
  }
  return out;
}

export const CLIP_SECONDS = 30;
