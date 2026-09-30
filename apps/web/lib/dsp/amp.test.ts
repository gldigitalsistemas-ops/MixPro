import { test } from "node:test";
import assert from "node:assert/strict";
import { AMP_MODELS } from "@mixpro/contracts";
import { amp } from "./amp";
import { applySections, butterworth } from "./filters";

const SR = 48000;

/** "Guitarra em linha": notas com ataque e decaimento (fundamental + harmônicos fracos). */
function diGuitar(freq = 196, seconds = 2) {
  const n = SR * seconds;
  const x = new Float32Array(n);
  for (let note = 0; note < 4; note++) {
    const s0 = Math.round(note * 0.5 * SR);
    for (let i = 0; i < SR * 0.5 && s0 + i < n; i++) {
      const t = i / SR;
      const env = Math.exp(-t / 0.35);
      x[s0 + i] = 0.2 * env * (Math.sin(2 * Math.PI * freq * t) + 0.3 * Math.sin(4 * Math.PI * freq * t));
    }
  }
  return x;
}

const rms = (x: Float32Array) => Math.sqrt(x.reduce((s, v) => s + v * v, 0) / x.length);
const base = { gain: 5, bass: 5, mid: 5, treble: 5, presence: 5, cabinet: "auto", blend: 100, level_db: 0 };

/** Energia acima de 1,5 kHz em relação ao total: mede os harmônicos criados pela distorção. */
function brightness(x: Float32Array) {
  const hi = x.slice();
  applySections(hi, butterworth("hp", 4, 1500, SR));
  return rms(hi) / rms(x);
}

test("Todos os amplificadores mantêm o volume da entrada e o áudio finito", () => {
  for (const { value: model } of AMP_MODELS) {
    const src = diGuitar(model.startsWith("bass") ? 55 : 196);
    const [out] = amp([src.slice()], SR, { ...base, model });
    assert.ok(out.every(Number.isFinite), model);
    const diff = 20 * Math.log10(rms(out) / rms(src));
    assert.ok(Math.abs(diff) < 3, `${model}: ${diff.toFixed(1)} dB`);
  }
});

test("Mais ganho = mais distorção; hi-gain distorce mais que o limpo", () => {
  const src = diGuitar();
  const bright = (model: string, gain: number) => brightness(amp([src.slice()], SR, { ...base, model, gain, cabinet: "none" })[0]);
  assert.ok(bright("crunch_uk", 10) > bright("crunch_uk", 0) * 1.5, "crunch 10 x 0");
  assert.ok(bright("hi_gain", 7) > bright("clean_us", 3) * 2, "hi-gain x limpo");
});

test("Linha 100% (blend 0) devolve o sinal original", () => {
  const src = diGuitar();
  const [out] = amp([src.slice()], SR, { ...base, model: "hi_gain", gain: 9, blend: 0 });
  let err = 0;
  for (let i = 0; i < src.length; i++) err = Math.max(err, Math.abs(out[i] - src[i]));
  assert.ok(err < 1e-6, `erro ${err}`);
});

test("Canais iguais são processados uma vez e continuam iguais", () => {
  const src = diGuitar();
  const out = amp([src.slice(), src.slice()], SR, { ...base, model: "rock_classic" });
  assert.deepEqual(out[0], out[1]);
});
