import { test } from "node:test";
import assert from "node:assert/strict";
import { alignWords } from "./align";

const SR = 16000;
let seed = 7;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;

/** "Fala": palavras (rajadas com tom) em tempos conhecidos, pausas entre frases e um fundo baixo. */
function speech(words: { start: number; end: number }[], seconds: number) {
  const x = new Float32Array(SR * seconds);
  for (let i = 0; i < x.length; i++) x[i] = 0.002 * rnd();
  for (const w of words) {
    for (let i = Math.round(w.start * SR); i < Math.round(w.end * SR); i++) {
      const t = (i - w.start * SR) / SR;
      const env = Math.min(1, t / 0.015) * Math.min(1, (w.end - i / SR) / 0.03);
      x[i] += 0.3 * env * Math.sin(2 * Math.PI * 160 * (i / SR)) * (0.7 + 0.3 * Math.sin(2 * Math.PI * 4 * t));
    }
  }
  return x as Float32Array<ArrayBuffer>;
}

const truth = [
  [0.5, 0.8], [0.85, 1.2], [1.25, 1.6], [2.4, 2.7], [2.78, 3.2], [3.3, 3.6], [4.6, 4.9], [4.95, 5.4],
  [6.3, 6.6], [6.7, 7.1], [7.2, 7.5], [8.5, 8.9], [9.0, 9.3],
].map(([start, end], i) => ({ text: `p${i}`, start, end }));

test("fala: frases escorregadas em até ±400 ms voltam para perto do som", () => {
  const x = speech(truth, 10);
  // como o Whisper erra: o trecho todo escorrega (para frente ou para trás), mantendo a ordem
  const phrase = [0, 0, 0, 1, 1, 1, 2, 2, 3, 3, 3, 4, 4];
  const slip = [0.35, -0.3, 0.4, -0.35, 0.3];
  const jitter = [0.02, -0.03, 0.04, 0, 0.03, -0.02, 0.01, -0.04, 0.02, 0.03, -0.01, 0.02, -0.03];
  const shifts = phrase.map((p, i) => slip[p] + jitter[i]);
  const off = truth.map((w, i) => ({ ...w, start: w.start + shifts[i], end: w.end + shifts[i] }));
  const before = off.reduce((n, w, i) => n + Math.abs(w.start - truth[i].start), 0) / truth.length;
  const out = alignWords(off, [x], SR);
  const errs = out.map((w, i) => Math.abs(w.start - truth[i].start));
  const after = errs.reduce((a, b) => a + b, 0) / errs.length;
  assert.ok(after < 0.08, `erro médio depois: ${(after * 1000).toFixed(0)} ms (antes ${(before * 1000).toFixed(0)} ms)`);
  // ordem mantida e sem sobreposição
  for (let i = 1; i < out.length; i++) assert.ok(out[i].start >= out[i - 1].end - 1e-9);
});

test("som contínuo (canto com instrumento): tempos do Whisper ficam, só sai do silêncio", () => {
  const x = new Float32Array(SR * 6) as Float32Array<ArrayBuffer>;
  for (let i = 0; i < x.length; i++) x[i] = 0.2 * Math.sin((2 * Math.PI * 220 * i) / SR) * (0.8 + 0.2 * Math.sin((2 * Math.PI * 3 * i) / SR));
  for (let i = SR * 2; i < SR * 2.6; i++) x[i] = 0; // um respiro de 600 ms
  const words = [
    { text: "a", start: 0.5, end: 1.5 },
    { text: "b", start: 2.1, end: 3.0 }, // começa no silêncio
    { text: "c", start: 3.4, end: 4.5 },
  ];
  const out = alignWords(words, [x], SR);
  assert.equal(out[0].start, 0.5);
  assert.equal(out[2].start, 3.4);
  assert.ok(out[1].start >= 2.55 && out[1].start <= 2.7, `b foi para ${out[1].start}`);
});

test("entrada vazia ou curta não quebra", () => {
  assert.deepEqual(alignWords([], [new Float32Array(100) as Float32Array<ArrayBuffer>], SR), []);
  const one = [{ text: "oi", start: 0.1, end: 0.3 }];
  assert.deepEqual(alignWords(one, [new Float32Array(SR) as Float32Array<ArrayBuffer>], SR), one);
});
