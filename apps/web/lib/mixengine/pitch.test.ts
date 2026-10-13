import { test } from "node:test";
import assert from "node:assert/strict";
import { hzToMidi, nearestInScale, noteShifts, scaleOf, segmentNotes, trackPitch, tuneVocal } from "./pitch";

const SR = 48000;

/** "Voz" sintética: harmônicos decrescentes, vibrato e envelope. */
function voice(notes: { hz: number; s: number; vibCents?: number }[], gap = 0.08): Float32Array<ArrayBuffer> {
  const total = notes.reduce((a, n) => a + n.s + gap, 0);
  const x = new Float32Array(Math.round(total * SR));
  let o = 0;
  for (const n of notes) {
    let ph = 0;
    const len = Math.round(n.s * SR);
    for (let i = 0; i < len; i++) {
      const vib = ((n.vibCents ?? 0) / 1200) * Math.sin((2 * Math.PI * 5.5 * i) / SR);
      const f = n.hz * 2 ** vib;
      ph += (2 * Math.PI * f) / SR;
      const env = Math.min(1, i / 2400, (len - i) / 2400);
      let v = 0;
      for (let h = 1; h <= 8; h++) v += Math.sin(h * ph) / h;
      x[o + i] = 0.3 * env * v;
    }
    o += len + Math.round(gap * SR);
  }
  return x;
}

const medianMidi = (x: Float32Array<ArrayBuffer>, from = 0.15, to = 0.85) => {
  const t = trackPitch([x], SR);
  const v: number[] = [];
  const a = Math.floor(t.f0.length * from);
  const b = Math.floor(t.f0.length * to);
  for (let i = a; i < b; i++) if (t.voiced[i]) v.push(hzToMidi(t.f0[i]));
  v.sort((p, q) => p - q);
  return v[Math.floor(v.length / 2)];
};

test("YIN acha a nota de um tom harmônico (A4 = 440 Hz) com precisão de poucos centavos", () => {
  const m = medianMidi(voice([{ hz: 440, s: 1 }]));
  assert.ok(Math.abs(m - 69) < 0.05, `midi ${m}`);
  assert.ok(Math.abs(medianMidi(voice([{ hz: 196, s: 1 }])) - 55) < 0.05, "G3");
});

test("escala: nota mais próxima dentro do tom (Dó maior)", () => {
  const c = scaleOf(0, "major");
  assert.equal(nearestInScale(61.4, c), 62, "C# vira D (mais perto)");
  assert.equal(nearestInScale(60.4, c), 60);
  assert.deepEqual(scaleOf(9, "minor"), [9, 11, 0, 2, 4, 5, 7]);
});

test("segmentação: duas notas viram duas notas", () => {
  const x = voice([{ hz: 440, s: 0.6 }, { hz: 493.88, s: 0.6 }]);
  const notes = segmentNotes(trackPitch([x], SR));
  assert.equal(notes.length, 2);
  assert.ok(Math.abs(notes[0].midi - 69) < 0.1 && Math.abs(notes[1].midi - 71) < 0.1);
});

test("afinação: nota 30 centavos acima vai ao centro, mantendo a duração e o vibrato", () => {
  const sharp = 440 * 2 ** (30 / 1200);
  const x = voice([{ hz: sharp, s: 1.2, vibCents: 25 }]);
  const before = medianMidi(x);
  assert.ok(Math.abs(before - 69.3) < 0.06, `antes ${before}`);
  const { out, report } = tuneVocal([x], SR, { amount: 1, scale: scaleOf(9, "major") });
  assert.equal(out[0].length, x.length, "mesma duração");
  const after = medianMidi(out[0]);
  assert.ok(Math.abs(after - 69) < 0.06, `depois ${after}`);
  assert.ok(report.notes >= 1 && report.maxCents >= 25 && report.maxCents <= 35, JSON.stringify(report));
  // vibrato preservado: a variação de altura dentro da nota continua
  const t = trackPitch(out, SR);
  const v = Array.from(t.f0).filter((f, i) => t.voiced[i] && i > 20 && i < t.f0.length - 20).map(hzToMidi);
  const spread = Math.max(...v) - Math.min(...v);
  assert.ok(spread > 0.25, `vibrato ${spread}`);
  // sem cliques nem perda de volume
  const rms = (a: Float32Array) => Math.sqrt(a.reduce((s, v) => s + v * v, 0) / a.length);
  const maxStep = (a: Float32Array) => a.reduce((m, v, i) => (i ? Math.max(m, Math.abs(v - a[i - 1])) : m), 0);
  assert.ok(Math.abs(20 * Math.log10(rms(out[0]) / rms(x))) < 1, "volume");
  assert.ok(maxStep(out[0]) < maxStep(x) * 1.6, `degraus ${maxStep(out[0])} × ${maxStep(x)}`);
});

test("afinação parcial (50%) corrige metade; 0% não muda nada; melodia do compositor manda", () => {
  const x = voice([{ hz: 440 * 2 ** (40 / 1200), s: 1 }]);
  const half = medianMidi(tuneVocal([x], SR, { amount: 0.5 }).out[0]);
  assert.ok(Math.abs(half - 69.2) < 0.07, `metade ${half}`);
  const zero = tuneVocal([x], SR, { amount: 0 });
  assert.deepEqual(Array.from(zero.out[0].subarray(1000, 1010)), Array.from(x.subarray(1000, 1010)));
  // a melodia manda: 70,6 vai a 71 (nota da melodia); uma nota cantada longe da melodia (> 0,9 st) não é forçada
  const shifts = noteShifts([{ start: 0, end: 1, midi: 70.6 }], { amount: 1, melody: [[71, 0, 1]] });
  assert.ok(Math.abs(shifts[0].shift - 0.4) < 1e-9 && shifts[0].target === 71);
  const far = noteShifts([{ start: 0, end: 1, midi: 69 }], { amount: 1, melody: [[71, 0, 1]] });
  assert.equal(far[0].shift, 0, "nota diferente de propósito não é forçada");
});
