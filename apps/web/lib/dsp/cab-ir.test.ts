import { test } from "node:test";
import assert from "node:assert/strict";
import { CABS, synthCabIR } from "./cab-ir";
import { amp, setImpulses } from "./amp";

const SR = 48000;

/** Ganho (dB) da IR numa frequência. */
function gainAt(ir: Float32Array, f: number, sr = SR) {
  let re = 0;
  let im = 0;
  for (let i = 0; i < ir.length; i++) {
    const w = (2 * Math.PI * f * i) / sr;
    re += ir[i] * Math.cos(w);
    im -= ir[i] * Math.sin(w);
  }
  return 20 * Math.log10(Math.hypot(re, im) + 1e-12);
}

test("caixas do Mix Pro: 5 de guitarra e 5 de baixo, ids únicos", () => {
  assert.equal(CABS.filter((c) => c.kind === "guitar").length, 5);
  assert.equal(CABS.filter((c) => c.kind === "bass").length, 5);
  assert.equal(new Set(CABS.map((c) => c.id)).size, CABS.length);
});

test("IR gerada: finita, energia 1 e em qualquer taxa de áudio", () => {
  for (const sr of [22050, 44100, 48000]) {
    for (const c of CABS) {
      const ir = synthCabIR(c, sr);
      assert.ok(ir.every(Number.isFinite), c.id);
      const e = ir.reduce((s, v) => s + v * v, 0);
      assert.ok(Math.abs(e - 1) < 1e-3, `${c.id} energia ${e}`);
    }
  }
});

test("guitarra corta o agudo do captador; baixo segura o grave", () => {
  for (const c of CABS) {
    const ir = synthCabIR(c, SR);
    const mid = gainAt(ir, c.kind === "guitar" ? 2500 : 800);
    if (c.kind === "guitar") {
      assert.ok(gainAt(ir, 12000) < mid - 20, `${c.id}: agudo de 12 kHz deveria cair`);
      assert.ok(gainAt(ir, 40) < mid - 6, `${c.id}: subgrave deveria cair`);
    } else {
      assert.ok(gainAt(ir, 60) > mid - 8, `${c.id}: grave de 60 Hz deveria ficar`);
    }
  }
});

test("caixas diferentes soam diferentes e a mesma caixa é sempre igual", () => {
  const a = synthCabIR(CABS[0], SR);
  assert.deepEqual(a, synthCabIR(CABS[0], SR));
  const b = synthCabIR(CABS[1], SR);
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff += Math.abs(a[i] - b[i]);
  assert.ok(diff > 1);
});

test("amplificador usa a caixa do Mix Pro sem mudar o volume", () => {
  const c = CABS.find((x) => x.id === "mp:g-4x12-v30")!;
  setImpulses({ [c.id]: synthCabIR(c, SR) });
  const x = new Float32Array(SR);
  for (let i = 0; i < x.length; i++) x[i] = 0.2 * Math.exp(-(i % 12000) / 4000) * Math.sin((2 * Math.PI * 147 * i) / SR);
  const rms = (v: Float32Array) => Math.sqrt(v.reduce((s, y) => s + y * y, 0) / v.length);
  const before = rms(x);
  const [out] = amp([x.slice()], SR, { model: "rock_classic", gain: 6, bass: 5, mid: 5, treble: 5, presence: 5, cabinet: "auto", ir: c.id, blend: 100, level_db: 0 });
  assert.ok(out.every(Number.isFinite));
  assert.ok(Math.abs(20 * Math.log10(rms(out) / before)) < 3);
  setImpulses(null);
});
