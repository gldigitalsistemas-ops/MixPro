import { test } from "node:test";
import assert from "node:assert/strict";
import { convolve } from "./convolve";
import { amp, setImpulses } from "./amp";
import { chorus, octaver, overdrive } from "./pedals";
import { applySections, butterworth } from "./filters";

const SR = 48000;
const sine = (f: number, sec: number, a = 0.3) => Float32Array.from({ length: Math.round(SR * sec) }, (_, i) => a * Math.sin((2 * Math.PI * f * i) / SR));
const rms = (x: Float32Array) => Math.sqrt(x.reduce((s, v) => s + v * v, 0) / x.length);
const band = (x: Float32Array, lo: number, hi: number) => {
  const y = x.slice();
  applySections(y, [...butterworth("hp", 4, lo, SR), ...butterworth("lp", 4, hi, SR)]);
  return rms(y);
};

test("Convolução por FFT = convolução direta", () => {
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
  const x = Float32Array.from({ length: 5000 }, rnd);
  const ir = Float32Array.from({ length: 700 }, (_, i) => rnd() * Math.exp(-i / 100));
  const fast = convolve(x, ir);
  let err = 0;
  for (let n = 0; n < x.length; n += 37) {
    let s = 0;
    for (let k = 0; k < ir.length && k <= n; k++) s += ir[k] * x[n - k];
    err = Math.max(err, Math.abs(s - fast[n]));
  }
  assert.ok(err < 1e-4, `erro ${err}`);
});

test("Amplificador usa a caixa gravada (IR) quando escolhida", () => {
  const base = { model: "clean_us", gain: 3, bass: 5, mid: 5, treble: 5, presence: 5, cabinet: "auto", blend: 100, level_db: 0 };
  // IR "escura": passa-baixas de um polo bem grave → agudo some
  const ir = Float32Array.from({ length: 2048 }, (_, i) => Math.exp(-i / 200));
  setImpulses({ "cab-teste": ir });
  const src = sine(2000, 0.5);
  const withIr = amp([src.slice()], SR, { ...base, ir: "cab-teste" })[0];
  const withoutIr = amp([src.slice()], SR, { ...base, ir: "" })[0];
  setImpulses(null);
  // volume casado nos dois casos; a IR muda o timbre (o 2 kHz perde para os harmônicos graves do amp)
  assert.ok(Number.isFinite(rms(withIr)) && Math.abs(20 * Math.log10(rms(withIr) / rms(src))) < 3);
  assert.notDeepEqual(withIr.slice(1000, 1100), withoutIr.slice(1000, 1100));
});

test("Overdrive cria harmônicos e mantém o volume", () => {
  const src = sine(220, 0.5);
  const [out] = overdrive([src.slice()], SR, { drive: 8, tone: 6, level_db: 0 });
  assert.ok(band(out, 600, 3000) > band(src, 600, 3000) * 5, "harmônicos");
  assert.ok(Math.abs(20 * Math.log10(rms(out) / rms(src))) < 3, "volume");
});

test("Oitavador soma uma oitava abaixo (110 Hz a partir de 220 Hz)", () => {
  const src = sine(220, 1);
  const [out] = octaver([src.slice()], SR, { octave: 100, dry: 0, tone_hz: 500 });
  assert.ok(band(out, 90, 135) > band(out, 190, 250) * 2, `oitava ${band(out, 90, 135)} x original ${band(out, 190, 250)}`);
});

test("Chorus altera o som e fica finito em mono e estéreo", () => {
  for (const chs of [1, 2]) {
    const src = Array.from({ length: chs }, () => sine(440, 0.5));
    const out = chorus(src.map((c) => c.slice()), SR, { rate_hz: 1, depth: 60, mix: 50 });
    assert.ok(out.every((c) => c.every(Number.isFinite)));
    assert.notDeepEqual(out[0].slice(5000, 5100), src[0].slice(5000, 5100));
  }
});
