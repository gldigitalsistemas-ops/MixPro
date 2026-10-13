import { test } from "node:test";
import assert from "node:assert/strict";
import { applyAlignment, measureAlignment } from "./align";

const SR = 48000;

function drumHits(seconds: number) {
  const x = new Float32Array(SR * seconds);
  let seed = 7;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff) * 2 - 1;
  for (let hit = 0; hit < seconds * 4; hit++) {
    const o = Math.round((hit / 4) * SR);
    for (let i = 0; i < 4000 && o + i < x.length; i++) x[o + i] += rnd() * Math.exp(-i / 600) * 0.6 + Math.sin((2 * Math.PI * 60 * i) / SR) * Math.exp(-i / 1500) * 0.5;
  }
  return x;
}

test("acha o atraso e a polaridade de um microfone de caixa em relação ao overhead", () => {
  const oh = drumHits(5);
  // microfone de perto: chega 3,2 ms ANTES do overhead e com polaridade invertida
  const lag = Math.round(0.0032 * SR);
  const close = new Float32Array(oh.length);
  for (let i = 0; i < oh.length; i++) close[i] = -(oh[i + lag] ?? 0) * 1.5;
  const r = measureAlignment([oh], [close], SR);
  assert.equal(r.lag, lag);
  assert.equal(r.flip, true);
  assert.ok(r.corr > 0.9);
  // corrigido: soma sem cancelamento (energia ≈ soma das amplitudes)
  const fixed = applyAlignment([close], r.lag, r.flip)[0];
  let before = 0;
  let after = 0;
  for (let i = SR; i < oh.length - SR; i++) {
    before += (oh[i] + close[i]) ** 2;
    after += (oh[i] + fixed[i]) ** 2;
  }
  assert.ok(after > before * 2.2, `soma corrigida ${after} × ${before}`);
});

test("pistas de fontes diferentes: correlação baixa (nada é mexido)", () => {
  const a = drumHits(4);
  const b = new Float32Array(a.length);
  for (let i = 0; i < b.length; i++) b[i] = Math.sin((2 * Math.PI * 330 * i) / SR) * 0.3;
  assert.ok(measureAlignment([a], [b], SR).corr < 0.3);
});
