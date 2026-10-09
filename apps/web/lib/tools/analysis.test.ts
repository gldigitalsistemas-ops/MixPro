import { test } from "node:test";
import assert from "node:assert/strict";
import { detectBpm, detectKey, octaveSpectrumDb, OCTAVE_CENTERS, transposeKey } from "./analysis";
import type { Signal } from "@/lib/dsp/types";

const SR = 44100;

/** Clique de bumbo (seno grave que decai) a cada batida + chimbal nos contratempos. */
function beat(bpm: number, seconds: number): Signal {
  const x = new Float32Array(SR * seconds);
  const period = (60 / bpm) * SR;
  let seed = 3;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
  for (let b = 0; b * period < x.length; b++) {
    const s = Math.round(b * period);
    for (let i = 0; i < SR * 0.15 && s + i < x.length; i++) x[s + i] += 0.8 * Math.exp(-i / (SR * 0.04)) * Math.sin((2 * Math.PI * 60 * i) / SR);
    const h = Math.round(s + period / 2);
    for (let i = 0; i < SR * 0.04 && h + i < x.length; i++) x[h + i] += 0.2 * Math.exp(-i / (SR * 0.01)) * rnd();
  }
  return [x];
}

/** Acordes da escala (I–IV–V–I) com harmônicos: a tônica é a nota mais presente. */
function chords(rootMidi: number, minor: boolean, seconds: number): Signal {
  const third = minor ? 3 : 4;
  const prog = [[0, third, 7], [5, 5 + (minor ? 3 : 4), 12], [7, 7 + 4, 14], [0, third, 7]];
  const x = new Float32Array(SR * seconds);
  const seg = x.length / prog.length;
  prog.forEach((ch, p) => {
    for (const st of [...ch, 0, -12]) {
      const f = 440 * 2 ** ((rootMidi + st - 69) / 12);
      for (let i = Math.floor(p * seg); i < Math.floor((p + 1) * seg); i++) for (let h = 1; h <= 3; h++) x[i] += (0.05 / h) * Math.sin((2 * Math.PI * f * h * i) / SR);
    }
  });
  return [x];
}

test("BPM: acerta andamentos comuns (sem dobrar nem cortar pela metade)", () => {
  for (const bpm of [80, 100, 120, 140]) {
    const r = detectBpm(beat(bpm, 20), SR);
    assert.ok(r, `${bpm}`);
    assert.ok(Math.abs(r!.bpm - bpm) <= 2, `esperado ${bpm}, veio ${r!.bpm}`);
  }
});

test("BPM: áudio curto ou silêncio não inventa resultado", () => {
  assert.equal(detectBpm([new Float32Array(SR * 3)], SR), null);
});

test("tonalidade: Ré maior, Lá menor e Mi maior", () => {
  assert.equal(detectKey(chords(62, false, 12), SR)?.name, "D");
  assert.equal(detectKey(chords(57, true, 12), SR)?.name, "Am");
  const e = detectKey(chords(64, false, 12), SR)!;
  assert.equal(e.label, "Mi maior");
  assert.equal(transposeKey(e, -2).label, "Ré maior");
  assert.equal(transposeKey(e, 13).name, "F");
});

test("espectro por oitava: seno de 1 kHz domina a banda de 1 kHz", () => {
  const x = new Float32Array(SR * 4);
  for (let i = 0; i < x.length; i++) x[i] = 0.5 * Math.sin((2 * Math.PI * 1000 * i) / SR);
  const db = octaveSpectrumDb([x], SR);
  const peak = db.indexOf(Math.max(...db));
  assert.equal(OCTAVE_CENTERS[peak], 1000);
});
