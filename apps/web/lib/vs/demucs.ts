/**
 * HT-Demucs v4 (Meta, MIT) no aparelho: o modelo ONNX faz só a rede; o espectrograma de entrada,
 * a normalização, a máscara e a volta ao áudio ficam aqui, iguais ao código original em PyTorch
 * (demucs/htdemucs.py: _spec, _magnitude, _mask, _ispec).
 *
 * A música (44,1 kHz, estéreo) é processada em blocos de ~7,8 s com 25% de sobreposição e emendada
 * com pesos triangulares. A saída sai em fluxo (bloco a bloco), sem guardar a música inteira em float.
 */
import { FFT, hann, istft, reflectPad, stft } from "./spectral";

export const SR = 44100;
export const SEGMENT = 343980;
// sobreposição de 25% entre blocos (padrão do Demucs): um terço mais rápido que 50%
export const STEP = (SEGMENT * 3) / 4;
const NFFT = 4096;
const HOP = 1024;
const LE = Math.ceil(SEGMENT / HOP); // 336 quadros
const PAD = (HOP / 2) * 3; // 1536
const BINS = NFFT / 2; // 2048 (o último bin é descartado)

export const STEMS = ["drums", "bass", "other", "vocals"] as const;
export type Stem = (typeof STEMS)[number];

export type ModelRun = (x: Float32Array, xt: Float32Array) => Promise<{ x: Float32Array; xt: Float32Array }>;

const fft = new FFT(NFFT);
const win = hann(NFFT);

function meanStd(a: Float32Array): [number, number] {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i];
  const mean = s / a.length;
  let v = 0;
  for (let i = 0; i < a.length; i++) v += (a[i] - mean) ** 2;
  return [mean, Math.sqrt(v / Math.max(1, a.length - 1))]; // torch.std: correção de Bessel
}

/** Entradas normalizadas do modelo para um bloco estéreo de SEGMENT amostras. */
export function preprocess(left: Float32Array, right: Float32Array) {
  const x = new Float32Array(4 * BINS * LE);
  [left, right].forEach((ch, c) => {
    const padded = reflectPad(ch, PAD, PAD + LE * HOP - SEGMENT);
    const z = stft(padded, NFFT, HOP, fft, win); // 2049 bins × 340 quadros
    for (let k = 0; k < BINS; k++) {
      for (let t = 0; t < LE; t++) {
        const src = k * z.frames + t + 2;
        x[(2 * c) * BINS * LE + k * LE + t] = z.re[src];
        x[(2 * c + 1) * BINS * LE + k * LE + t] = z.im[src];
      }
    }
  });
  const [mean, std] = meanStd(x);
  for (let i = 0; i < x.length; i++) x[i] = (x[i] - mean) / (1e-5 + std);

  const xt = new Float32Array(2 * SEGMENT);
  xt.set(left, 0);
  xt.set(right, SEGMENT);
  const [meant, stdt] = meanStd(xt);
  for (let i = 0; i < xt.length; i++) xt[i] = (xt[i] - meant) / (1e-5 + stdt);
  return { x, xt, mean, std, meant, stdt };
}

/** Saídas do modelo → 4 instrumentos × 2 canais de SEGMENT amostras. */
export function postprocess(xOut: Float32Array, xtOut: Float32Array, n: { mean: number; std: number; meant: number; stdt: number }): Float32Array[][] {
  const frames = LE + 4;
  const bins = BINS + 1;
  const re = new Float32Array(bins * frames);
  const im = new Float32Array(bins * frames);
  return STEMS.map((_, s) =>
    [0, 1].map((c) => {
      re.fill(0);
      im.fill(0);
      const baseRe = (4 * s + 2 * c) * BINS * LE;
      const baseIm = (4 * s + 2 * c + 1) * BINS * LE;
      for (let k = 0; k < BINS; k++) {
        for (let t = 0; t < LE; t++) {
          re[k * frames + t + 2] = xOut[baseRe + k * LE + t] * n.std + n.mean;
          im[k * frames + t + 2] = xOut[baseIm + k * LE + t] * n.std + n.mean;
        }
      }
      const spec = istft(re, im, bins, frames, NFFT, HOP, HOP * LE + 2 * PAD, fft, win).subarray(PAD, PAD + SEGMENT);
      const out = new Float32Array(SEGMENT);
      const t0 = (2 * s + c) * SEGMENT;
      for (let i = 0; i < SEGMENT; i++) out[i] = xtOut[t0 + i] * n.stdt + n.meant + spec[i];
      return out;
    }),
  );
}

/** Peso triangular da emenda (como o apply_model do Demucs). */
const weight = (() => {
  const w = new Float32Array(SEGMENT);
  for (let i = 0; i < SEGMENT; i++) w[i] = Math.min(i + 1, SEGMENT - i);
  return w;
})();

/** Quantos blocos de ~7,8 s a música tem. */
export const blockCount = (n: number) => (n <= SEGMENT ? 1 : Math.ceil((n - SEGMENT) / STEP) + 1);

/**
 * Separa a música inteira. `out(stem, canal, início, dados)` recebe cada trecho pronto, em ordem.
 * `left/right` a 44,1 kHz.
 */
export async function separate(
  left: Float32Array,
  right: Float32Array,
  run: ModelRun,
  out: (stem: number, ch: number, offset: number, data: Float32Array) => void,
  onProgress?: (done: number, total: number) => void,
  shouldStop?: () => boolean,
) {
  const n = left.length;
  const total = blockCount(n);
  const pend = STEMS.map(() => [new Float32Array(SEGMENT), new Float32Array(SEGMENT)]);
  const pw = new Float32Array(SEGMENT);
  const segL = new Float32Array(SEGMENT);
  const segR = new Float32Array(SEGMENT);
  let k = 0;
  for (let start = 0; start < n; start += STEP, k++) {
    if (shouldStop?.()) throw new DOMException("cancelado", "AbortError");
    segL.fill(0);
    segR.fill(0);
    segL.set(left.subarray(start, Math.min(n, start + SEGMENT)));
    segR.set(right.subarray(start, Math.min(n, start + SEGMENT)));
    const pre = preprocess(segL, segR);
    const res = await run(pre.x, pre.xt);
    const stems = postprocess(res.x, res.xt, pre);
    for (let s = 0; s < STEMS.length; s++) for (let c = 0; c < 2; c++) for (let i = 0; i < SEGMENT; i++) pend[s][c][i] += stems[s][c][i] * weight[i];
    for (let i = 0; i < SEGMENT; i++) pw[i] += weight[i];

    // o começo do bloco não muda mais (o próximo começa STEP depois): entrega e desliza
    const last = start + SEGMENT >= n;
    const ready = Math.min(last ? SEGMENT : STEP, n - start);
    for (let s = 0; s < STEMS.length; s++) {
      for (let c = 0; c < 2; c++) {
        const chunk = new Float32Array(ready);
        for (let i = 0; i < ready; i++) chunk[i] = pend[s][c][i] / pw[i];
        out(s, c, start, chunk);
        pend[s][c].copyWithin(0, STEP);
        pend[s][c].fill(0, SEGMENT - STEP);
      }
    }
    pw.copyWithin(0, STEP);
    pw.fill(0, SEGMENT - STEP);
    onProgress?.(Math.min(k + 1, total), total);
    if (last) break;
  }
}
