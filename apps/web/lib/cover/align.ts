/**
 * Sincronia do Modo Cover: em que instante do vídeo começa a música.
 *
 * O músico toca em cima da música (com fone), então o áudio do vídeo tem a performance dele e, às vezes, a música
 * vazando. Os ataques (fluxo de energia a cada 10 ms) do vídeo são comparados por correlação cruzada (FFT) com os
 * ataques do instrumento original que ele está tocando e com os da música inteira; vence o pico mais destacado.
 * Depois, um refinamento a cada 1 ms em volta do pico.
 */
import { fft } from "@/lib/dsp/convolve";
import type { Signal } from "@/lib/dsp/types";

const mono = (x: Signal): Float32Array => {
  if (x.length === 1) return x[0];
  const m = new Float32Array(x[0].length);
  for (const c of x) for (let i = 0; i < m.length; i++) m[i] += c[i] / x.length;
  return m;
};

/** Ataques: log da energia por quadro, só a subida, menos a média local (realça as batidas). */
export function onsetEnvelope(x: Signal | Float32Array, sr: number, rate = 100): Float32Array<ArrayBuffer> {
  const m = x instanceof Float32Array ? x : mono(x);
  // quadros com início exato em f·sr/rate (sem arredondar o passo): a escala de tempo é a mesma em 44,1 e 48 kHz
  const step = sr / rate;
  const frames = Math.floor(m.length / step);
  const e = new Float32Array(frames);
  for (let f = 0; f < frames; f++) {
    const a = Math.round(f * step);
    const b = Math.min(m.length, Math.round((f + 1) * step));
    let s = 0;
    for (let i = a; i < b; i++) s += m[i] * m[i];
    e[f] = Math.log1p(1e4 * (s / Math.max(1, b - a)));
  }
  const d = new Float32Array(frames);
  for (let f = 1; f < frames; f++) d[f] = Math.max(0, e[f] - e[f - 1]);
  // tira a média móvel (~0,3 s): sobra o pulso, não o volume
  const w = Math.max(1, Math.round(rate * 0.15));
  const out = new Float32Array(frames);
  let acc = 0;
  for (let f = 0; f < frames + w; f++) {
    if (f < frames) acc += d[f];
    if (f - 2 * w - 1 >= 0) acc -= d[f - 2 * w - 1];
    const c = f - w;
    if (c >= 0 && c < frames) out[c] = Math.max(0, d[c] - acc / (2 * w + 1));
  }
  return out;
}

/** Correlação cruzada por FFT: c[lag] = Σ a[i]·b[i − lag], para lag de −(b−1) a a−1. */
function xcorr(a: Float32Array, b: Float32Array): { values: Float64Array; zero: number } {
  let n = 1;
  while (n < a.length + b.length) n <<= 1;
  const ar = new Float64Array(n);
  const ai = new Float64Array(n);
  const br = new Float64Array(n);
  const bi = new Float64Array(n);
  ar.set(a);
  br.set(b);
  fft(ar, ai);
  fft(br, bi);
  for (let k = 0; k < n; k++) {
    // A · conj(B)
    const re = ar[k] * br[k] + ai[k] * bi[k];
    const im = ai[k] * br[k] - ar[k] * bi[k];
    ar[k] = re;
    ai[k] = im;
  }
  fft(ar, ai, true);
  // lags negativos ficam no fim do vetor circular
  const values = new Float64Array(a.length + b.length - 1);
  const zero = b.length - 1;
  for (let lag = -(b.length - 1); lag < a.length; lag++) values[lag + zero] = ar[(lag + n) % n];
  return { values, zero };
}

export type AlignResult = {
  /** Instante do vídeo (s) em que começa a música (negativo: a gravação começou depois do início da música). */
  offsetS: number;
  /** Quanto o pico se destaca do resto (≥ 6 é seguro; < 4, conferir de ouvido). */
  confidence: number;
  /** Com o quê casou melhor. */
  by: "instrumento" | "musica" | "estimativa";
};

function bestPeak(a: Float32Array, b: Float32Array, rate: number, range: [number, number] | null): { lag: number; z: number } | null {
  if (a.length < rate * 2 || b.length < rate * 2) return null;
  const { values, zero } = xcorr(a, b);
  const lo = Math.max(-(b.length - 1), range ? Math.round(range[0] * rate) : -(b.length - 1));
  const hi = Math.min(a.length - 1, range ? Math.round(range[1] * rate) : a.length - 1);
  if (hi <= lo) return null;
  let best = -Infinity;
  let bestLag = lo;
  let sum = 0;
  let sum2 = 0;
  let count = 0;
  for (let lag = lo; lag <= hi; lag++) {
    const v = values[lag + zero];
    sum += v;
    sum2 += v * v;
    count++;
    if (v > best) {
      best = v;
      bestLag = lag;
    }
  }
  const mean = sum / count;
  const sd = Math.sqrt(Math.max(1e-12, sum2 / count - mean * mean));
  return { lag: bestLag, z: (best - mean) / sd };
}

/** Refina o atraso a cada 1 ms (±30 ms em volta do pico), num trecho de até 40 s com bastante música. */
function refine(video: Float32Array, videoSr: number, ref: Float32Array, refSr: number, coarseS: number): number {
  const A = onsetEnvelope(video, videoSr, 1000);
  const B = onsetEnvelope(ref, refSr, 1000);
  const base = Math.round(coarseS * 1000);
  // trecho da música: a partir de 2 s (pula a introdução silenciosa), até 40 s
  const b0 = Math.min(Math.max(0, B.length - 1), 2000);
  const b1 = Math.min(B.length, b0 + 40_000);
  let best = -Infinity;
  let bestD = 0;
  for (let d = -30; d <= 30; d++) {
    let s = 0;
    for (let j = b0; j < b1; j++) {
      const i = j + base + d;
      if (i >= 0 && i < A.length) s += A[i] * B[j];
    }
    if (s > best) {
      best = s;
      bestD = d;
    }
  }
  return (base + bestD) / 1000;
}

/**
 * Em que instante do vídeo começa a música. `instrument` = a pista original do que a pessoa tocou (ex.: a bateria);
 * `song` = a música inteira; `estimate` = palpite da gravação no app (busca só ±1,5 s em volta).
 */
export function alignCover(video: Signal, videoSr: number, instrument: Signal, song: Signal, refSr: number, estimate?: number | null): AlignResult {
  const rate = 100;
  const v = onsetEnvelope(video, videoSr, rate);
  const range: [number, number] | null = estimate === null || estimate === undefined ? null : [estimate - 1.5, estimate + 1.5];
  const byInst = bestPeak(v, onsetEnvelope(instrument, refSr, rate), rate, range);
  const bySong = bestPeak(v, onsetEnvelope(song, refSr, rate), rate, range);
  const pick = byInst && (!bySong || byInst.z >= bySong.z) ? { ...byInst, by: "instrumento" as const } : bySong ? { ...bySong, by: "musica" as const } : null;
  if (!pick || (pick.z < 4 && estimate !== null && estimate !== undefined)) {
    return { offsetS: estimate ?? 0, confidence: pick?.z ?? 0, by: "estimativa" };
  }
  const coarse = pick.lag / rate;
  const fine = refine(mono(video), videoSr, mono(pick.by === "instrumento" ? instrument : song), refSr, coarse);
  return { offsetS: Math.round(fine * 1000) / 1000, confidence: Math.round(pick.z * 10) / 10, by: pick.by };
}
