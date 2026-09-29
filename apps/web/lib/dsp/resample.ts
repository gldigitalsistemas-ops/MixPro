/** Reamostragem de razão arbitrária por sinc janelado (Kaiser β=8, 32 lóbulos) — ~ -80 dB de aliasing. */

const ZEROS = 16;
const TABLE_RES = 512;
const BETA = 8;

function besselI0(x: number): number {
  let sum = 1;
  let term = 1;
  for (let k = 1; k < 60; k++) {
    term *= (x / (2 * k)) ** 2;
    sum += term;
    if (term < 1e-14 * sum) break;
  }
  return sum;
}

/** Kernel tabelado em t ∈ [0, ZEROS] (simétrico). */
const KERNEL: Float64Array = (() => {
  const n = ZEROS * TABLE_RES + 2;
  const k = new Float64Array(n);
  const i0 = besselI0(BETA);
  for (let i = 0; i < n; i++) {
    const t = i / TABLE_RES;
    const sinc = t === 0 ? 1 : Math.sin(Math.PI * t) / (Math.PI * t);
    const r = t / ZEROS;
    k[i] = r >= 1 ? 0 : sinc * (besselI0(BETA * Math.sqrt(1 - r * r)) / i0);
  }
  return k;
})();

function kernel(t: number): number {
  const a = Math.abs(t) * TABLE_RES;
  const i = Math.floor(a);
  if (i >= KERNEL.length - 1) return 0;
  const f = a - i;
  return KERNEL[i] * (1 - f) + KERNEL[i + 1] * f;
}

export function resample(x: Float32Array<ArrayBuffer>, from: number, to: number): Float32Array<ArrayBuffer> {
  if (from === to) return x.slice();
  const ratio = to / from;
  const outLen = Math.round(x.length * ratio);
  const out = new Float32Array(outLen);
  // ao reduzir a taxa, o filtro é alargado para cortar acima do novo Nyquist
  const scale = Math.min(1, ratio);
  const half = ZEROS / scale;
  for (let j = 0; j < outLen; j++) {
    const center = j / ratio;
    const lo = Math.max(0, Math.ceil(center - half));
    const hi = Math.min(x.length - 1, Math.floor(center + half));
    let s = 0;
    for (let i = lo; i <= hi; i++) s += x[i] * kernel((i - center) * scale);
    out[j] = s * scale;
  }
  return out;
}
