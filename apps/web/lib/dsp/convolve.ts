/**
 * Convolução rápida (FFT, overlap-add) — usada para as caixas gravadas (IR) do amplificador.
 * Uma IR de caixa tem ~20–200 ms; convolução direta num minuto de áudio seria lenta demais.
 */

/** FFT complexa in-place, radix-2 (n potência de 2). `inverse` já divide por n. */
export function fft(re: Float64Array, im: Float64Array, inverse = false): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = ((inverse ? 2 : -2) * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k;
        const b = a + len / 2;
        const tr = re[b] * cr - im[b] * ci;
        const ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = ncr;
      }
    }
  }
  if (inverse) {
    for (let i = 0; i < n; i++) {
      re[i] /= n;
      im[i] /= n;
    }
  }
}

/** Convolui `x` com `ir` (mesmo comprimento de saída que `x`, cauda descartada). */
export function convolve(x: Float32Array, ir: Float32Array): Float32Array<ArrayBuffer> {
  const m = ir.length;
  let size = 1;
  while (size < m * 2) size <<= 1;
  const block = size - m + 1;
  const hr = new Float64Array(size);
  const hi = new Float64Array(size);
  hr.set(ir);
  fft(hr, hi);

  const out = new Float32Array(x.length + m);
  const re = new Float64Array(size);
  const im = new Float64Array(size);
  for (let pos = 0; pos < x.length; pos += block) {
    re.fill(0);
    im.fill(0);
    const len = Math.min(block, x.length - pos);
    for (let i = 0; i < len; i++) re[i] = x[pos + i];
    fft(re, im);
    for (let k = 0; k < size; k++) {
      const r = re[k] * hr[k] - im[k] * hi[k];
      im[k] = re[k] * hi[k] + im[k] * hr[k];
      re[k] = r;
    }
    fft(re, im, true);
    const end = Math.min(size, out.length - pos);
    for (let i = 0; i < end; i++) out[pos + i] += re[i];
  }
  return out.slice(0, x.length);
}
