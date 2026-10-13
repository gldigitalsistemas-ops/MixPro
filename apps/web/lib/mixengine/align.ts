/**
 * Fase e tempo entre pistas que captam a mesma fonte (microfones de bateria, baixo em linha + amplificador,
 * violão com dois microfones): acha o atraso (até ±10 ms) e a polaridade pela correlação cruzada num
 * trecho com sinal, e corrige — é o que evita graves "ocos" e cancelamento quando as pistas somam.
 */
import type { Signal } from "@/lib/dsp/types";

export type AlignResult = { lag: number; flip: boolean; corr: number };

const mono = (x: Signal) => {
  if (x.length === 1) return x[0];
  const m = new Float32Array(x[0].length);
  for (const ch of x) for (let i = 0; i < m.length; i++) m[i] += ch[i] / x.length;
  return m;
};

/** Trecho de `len` amostras com mais energia (decimado de 10 em 10 para ser rápido). */
function busiest(x: Float32Array, len: number): number {
  if (x.length <= len) return 0;
  const step = Math.max(1, Math.floor(len / 8));
  let best = 0;
  let bestE = -1;
  for (let s = 0; s + len <= x.length; s += step) {
    let e = 0;
    for (let i = s; i < s + len; i += 10) e += x[i] * x[i];
    if (e > bestE) {
      bestE = e;
      best = s;
    }
  }
  return best;
}

/**
 * Atraso de `track` em relação a `ref` (amostras; positivo = a pista chega antes e deve ser atrasada) e
 * se a polaridade está invertida. Correlação normalizada no trecho mais forte de 4 s da referência.
 */
export function measureAlignment(ref: Signal, track: Signal, sr: number, maxMs = 10): AlignResult {
  const a = mono(ref);
  const b = mono(track);
  const len = Math.min(a.length, b.length, Math.round(4 * sr));
  const maxLag = Math.round((maxMs / 1000) * sr);
  const s = busiest(b, len);
  let ea = 0;
  let eb = 0;
  for (let i = s; i < s + len && i < a.length && i < b.length; i++) {
    ea += a[i] * a[i];
    eb += b[i] * b[i];
  }
  const norm = Math.sqrt(ea * eb) || 1;
  let best = 0;
  let bestC = 0;
  for (let lag = -maxLag; lag <= maxLag; lag++) {
    let c = 0;
    for (let i = s + maxLag; i < s + len - maxLag && i + lag < a.length && i < b.length; i++) c += a[i + lag] * b[i];
    if (Math.abs(c) > Math.abs(bestC)) {
      bestC = c;
      best = lag;
    }
  }
  return { lag: best, flip: bestC < 0, corr: Math.abs(bestC) / norm };
}

/** Aplica atraso (amostras, ≥ 0 atrasa; < 0 adianta) e polaridade, mantendo o tamanho. */
export function applyAlignment(x: Signal, lag: number, flip: boolean): Signal {
  const g = flip ? -1 : 1;
  return x.map((ch) => {
    const out = new Float32Array(ch.length);
    for (let i = 0; i < ch.length; i++) {
      const j = i - lag;
      out[i] = j >= 0 && j < ch.length ? ch[j] * g : 0;
    }
    return out;
  }) as Signal;
}

/** Só corrige quando as pistas são claramente da mesma fonte (correlação ≥ 0,3). */
export const ALIGN_MIN_CORR = 0.3;
