import { test } from "node:test";
import assert from "node:assert/strict";
import { FFT, hann, istft, stft } from "./spectral";

test("STFT seguido de iSTFT devolve o mesmo áudio (como no PyTorch)", () => {
  const nfft = 4096, hop = 1024;
  const fft = new FFT(nfft), win = hann(nfft);
  const x = new Float32Array(44100);
  for (let i = 0; i < x.length; i++) x[i] = Math.sin(i / 7) * 0.5 + Math.sin(i / 53) * 0.3 + ((i * 7919) % 101) / 1000;
  const z = stft(x, nfft, hop, fft, win);
  assert.equal(z.bins, 2049);
  const y = istft(z.re, z.im, z.bins, z.frames, nfft, hop, x.length, fft, win);
  let err = 0;
  for (let i = 0; i < x.length; i++) err = Math.max(err, Math.abs(x[i] - y[i]));
  assert.ok(err < 1e-4, `erro ${err}`);
});

test("FFT de uma senoide pura cai no bin certo, com norma de Parseval", () => {
  const n = 1024, fft = new FFT(n);
  const re = new Float64Array(n), im = new Float64Array(n);
  for (let i = 0; i < n; i++) re[i] = Math.cos((2 * Math.PI * 10 * i) / n);
  fft.transform(re, im);
  assert.ok(Math.abs(re[10] - n / 2) < 1e-6 && Math.abs(re[11]) < 1e-6);
});
