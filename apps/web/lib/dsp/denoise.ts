/** Remoção de ruído de fundo com RNNoise (rede neural, roda em WebAssembly no aparelho). */
import type { Rnnoise } from "@shiguredo/rnnoise-wasm";
import { resample } from "./resample";
import type { Signal } from "./types";

const RATE = 48000;
/** Atraso interno do RNNoise a 48 kHz (2 quadros de 10 ms, medido), compensado para manter o sincronismo. */
export const RNNOISE_LATENCY = 960;

let loading: Promise<Rnnoise> | null = null;
function load(): Promise<Rnnoise> {
  loading ??= import("@shiguredo/rnnoise-wasm").then((m) => m.Rnnoise.load());
  return loading;
}

/**
 * @param amount 0–1: proporção do sinal limpo misturado ao original (1 = remoção total).
 * @param onProgress 0–1
 */
export async function denoise(
  audio: Signal,
  sr: number,
  amount: number,
  onProgress?: (v: number) => void,
): Promise<Signal> {
  if (amount <= 0) return audio;
  const rnnoise = await load();
  const frame = rnnoise.frameSize;
  const buf = new Float32Array(frame);

  // Gravação de celular costuma ser "estéreo" com canais quase iguais: processa uma vez só.
  const nearMono = audio.length === 2 && correlation(audio[0], audio[1]) > 0.97;
  const sources = nearMono ? [mixToMono(audio)] : audio;

  const cleaned = sources.map((dry, c) => {
    const x = resample(dry, sr, RATE);
    const n = x.length;
    // espaço extra no fim para "empurrar" a latência para fora
    const padded = new Float32Array(Math.ceil((n + RNNOISE_LATENCY) / frame) * frame);
    padded.set(x);
    const state = rnnoise.createDenoiseState();
    try {
      for (let pos = 0; pos < padded.length; pos += frame) {
        for (let i = 0; i < frame; i++) buf[i] = padded[pos + i] * 32768;
        state.processFrame(buf);
        for (let i = 0; i < frame; i++) padded[pos + i] = buf[i] / 32768;
        if ((pos / frame) % 200 === 0) onProgress?.((c + pos / padded.length) / sources.length);
      }
    } finally {
      state.destroy();
    }
    return resample(padded.slice(RNNOISE_LATENCY, RNNOISE_LATENCY + n), RATE, sr);
  });

  // Quase-mono: a diferença entre os canais é basicamente ruído de ambiente, então os dois recebem o sinal limpo.
  return audio.map((dry, c) => {
    const wet = cleaned[nearMono ? 0 : c];
    const out = new Float32Array(dry.length);
    for (let i = 0; i < out.length; i++) out[i] = dry[i] * (1 - amount) + (wet[i] ?? 0) * amount;
    return out;
  });
}

function mixToMono([l, r]: Signal): Float32Array<ArrayBuffer> {
  const m = new Float32Array(l.length);
  for (let i = 0; i < m.length; i++) m[i] = (l[i] + r[i]) * 0.5;
  return m;
}

function correlation(a: Float32Array, b: Float32Array): number {
  let ab = 0, aa = 0, bb = 0;
  for (let i = 0; i < a.length; i += 8) {
    ab += a[i] * b[i];
    aa += a[i] * a[i];
    bb += b[i] * b[i];
  }
  return aa > 0 && bb > 0 ? ab / Math.sqrt(aa * bb) : 1;
}
