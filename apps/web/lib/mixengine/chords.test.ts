import { test } from "node:test";
import assert from "node:assert/strict";
import { chordAgreement, chordPt, detectChords, progression } from "./chords";

const SR = 44100;

/** Violão sintético: tríade com 4 harmônicos, 2 s por acorde. */
function strum(chords: number[][], seconds = 2) {
  const x = new Float32Array(SR * seconds * chords.length);
  chords.forEach((notes, c) => {
    const o = c * seconds * SR;
    for (let i = 0; i < seconds * SR; i++) {
      const t = i / SR;
      let v = 0;
      for (const m of notes) {
        const f = 440 * 2 ** ((m - 69) / 12);
        for (let h = 1; h <= 4; h++) v += Math.sin(2 * Math.PI * f * h * t) / (h * h);
      }
      x[o + i] = 0.1 * v * Math.exp(-((t % 1) * 1.5));
    }
  });
  return x;
}

const C = [48, 52, 55, 60, 64];
const Am = [45, 52, 57, 60, 64];
const F = [41, 48, 53, 57, 60];
const G = [43, 50, 55, 59, 62];

test("progressão C–Am–F–G reconhecida", () => {
  const segs = detectChords([strum([C, Am, F, G])], SR);
  assert.deepEqual(progression(segs), ["C", "Am", "F", "G"]);
  assert.equal(chordPt("Am"), "Lá menor");
  assert.equal(chordPt("F#"), "Fá#");
});

test("concordância: mesma harmonia ≈ 1; harmonia diferente baixa", () => {
  const a = detectChords([strum([C, Am, F, G])], SR);
  const b = detectChords([strum([C, Am, F, G]).map((v) => v * 0.5)], SR);
  const c = detectChords([strum([G, F, Am, C])], SR);
  assert.ok(chordAgreement(a, b) > 0.9, String(chordAgreement(a, b)));
  assert.ok(chordAgreement(a, c) < 0.4, String(chordAgreement(a, c)));
});
