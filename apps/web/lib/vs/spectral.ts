/**
 * STFT/iSTFT iguais aos do PyTorch (torch.stft / torch.istft com center=True, normalized=True,
 * janela de Hann periódica e preenchimento "reflect"), usados pelo HT-Demucs.
 */

/** FFT radix-2 no lugar (re/im), tamanho potência de 2. */
export class FFT {
  readonly n: number;
  private rev: Uint32Array;
  private cos: Float64Array;
  private sin: Float64Array;

  constructor(n: number) {
    this.n = n;
    this.rev = new Uint32Array(n);
    const bits = Math.log2(n);
    for (let i = 0; i < n; i++) {
      let r = 0;
      for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b);
      this.rev[i] = r;
    }
    this.cos = new Float64Array(n / 2);
    this.sin = new Float64Array(n / 2);
    for (let i = 0; i < n / 2; i++) {
      this.cos[i] = Math.cos((2 * Math.PI * i) / n);
      this.sin[i] = Math.sin((2 * Math.PI * i) / n);
    }
  }

  /** inverse=false: X[k] = Σ x[n]·e^{-2πikn/N}; inverse=true: sem o 1/N. */
  transform(re: Float64Array, im: Float64Array, inverse = false) {
    const n = this.n;
    for (let i = 0; i < n; i++) {
      const j = this.rev[i];
      if (j > i) {
        [re[i], re[j]] = [re[j], re[i]];
        [im[i], im[j]] = [im[j], im[i]];
      }
    }
    const s = inverse ? 1 : -1;
    for (let size = 2; size <= n; size <<= 1) {
      const half = size >> 1;
      const step = n / size;
      for (let start = 0; start < n; start += size) {
        for (let k = 0; k < half; k++) {
          const wr = this.cos[k * step];
          const wi = s * this.sin[k * step];
          const a = start + k;
          const b = a + half;
          const tr = re[b] * wr - im[b] * wi;
          const ti = re[b] * wi + im[b] * wr;
          re[b] = re[a] - tr;
          im[b] = im[a] - ti;
          re[a] += tr;
          im[a] += ti;
        }
      }
    }
  }
}

export function hann(n: number): Float64Array {
  const w = new Float64Array(n);
  for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n);
  return w;
}

/** Reflexão como no PyTorch (sem repetir a borda). */
export function reflectPad(x: Float32Array, left: number, right: number): Float32Array {
  const n = x.length;
  const out = new Float32Array(n + left + right);
  out.set(x, left);
  for (let i = 0; i < left; i++) out[left - 1 - i] = x[Math.min(n - 1, i + 1)];
  for (let i = 0; i < right; i++) out[left + n + i] = x[Math.max(0, n - 2 - i)];
  return out;
}

/**
 * torch.stft(x, nfft, hop, window=hann(nfft), center=True, normalized=True, pad_mode="reflect").
 * Devolve re/im em [bins][frames] (bins = nfft/2+1), achatados por bin.
 */
export function stft(x: Float32Array, nfft: number, hop: number, fft: FFT, win: Float64Array) {
  const padded = reflectPad(x, nfft / 2, nfft / 2);
  const frames = 1 + Math.floor((padded.length - nfft) / hop);
  const bins = nfft / 2 + 1;
  const re = new Float32Array(bins * frames);
  const im = new Float32Array(bins * frames);
  const fr = new Float64Array(nfft);
  const fi = new Float64Array(nfft);
  const norm = 1 / Math.sqrt(nfft);
  for (let t = 0; t < frames; t++) {
    const o = t * hop;
    for (let i = 0; i < nfft; i++) {
      fr[i] = padded[o + i] * win[i];
      fi[i] = 0;
    }
    fft.transform(fr, fi);
    for (let k = 0; k < bins; k++) {
      re[k * frames + t] = fr[k] * norm;
      im[k * frames + t] = fi[k] * norm;
    }
  }
  return { re, im, bins, frames };
}

/**
 * torch.istft(z, nfft, hop, window=hann(nfft), center=True, normalized=True, length).
 * `re/im` em [bins][frames], bins = nfft/2+1.
 */
export function istft(re: Float32Array, im: Float32Array, bins: number, frames: number, nfft: number, hop: number, length: number, fft: FFT, win: Float64Array): Float32Array {
  const total = nfft + hop * (frames - 1);
  const acc = new Float64Array(total);
  const wsum = new Float64Array(total);
  const fr = new Float64Array(nfft);
  const fi = new Float64Array(nfft);
  const scale = Math.sqrt(nfft) / nfft; // normalized=True desfaz o 1/√N; a inversa leva 1/N
  for (let t = 0; t < frames; t++) {
    for (let k = 0; k < bins; k++) {
      fr[k] = re[k * frames + t];
      fi[k] = im[k * frames + t];
    }
    // espectro hermitiano
    for (let k = 1; k < nfft / 2; k++) {
      fr[nfft - k] = fr[k];
      fi[nfft - k] = -fi[k];
    }
    fi[0] = 0;
    fi[nfft / 2] = 0;
    fft.transform(fr, fi, true);
    const o = t * hop;
    for (let i = 0; i < nfft; i++) {
      acc[o + i] += fr[i] * scale * win[i];
      wsum[o + i] += win[i] * win[i];
    }
  }
  const out = new Float32Array(length);
  const start = nfft / 2;
  for (let i = 0; i < length; i++) {
    const j = start + i;
    out[i] = j < total && wsum[j] > 1e-11 ? acc[j] / wsum[j] : 0;
  }
  return out;
}
