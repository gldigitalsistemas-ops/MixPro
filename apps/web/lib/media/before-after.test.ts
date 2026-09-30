import { test } from "node:test";
import assert from "node:assert/strict";
import { beforeAfterAudio, outputToSource, splitOutputTime } from "./before-after";
import { integratedLoudness } from "@/lib/dsp/loudness";

const SR = 16000;
const tone = (f: number, sec: number, a: number) => Float32Array.from({ length: SR * sec }, (_, i) => a * Math.sin((2 * Math.PI * f * i) / SR));

test("Virada: 40% do vídeo, entre 2,5 s e 10 s", () => {
  assert.equal(splitOutputTime(10), 4);
  assert.equal(splitOutputTime(60), 10);
  assert.equal(splitOutputTime(4), 2);
});

test("Tempo do vídeo cortado → tempo do original", () => {
  const segs = [{ start: 0, end: 2 }, { start: 5, end: 8 }];
  assert.equal(outputToSource(segs, 1), 1);
  assert.equal(outputToSource(segs, 3), 6);
});

test("Antes = original no mesmo volume; depois = tratado", () => {
  // original ~9 dB mais baixo (o limite de subida é 12 dB)
  const original = [tone(220, 10, 0.15)];
  const processed = [tone(440, 10, 0.4)];
  const { audio, split } = beforeAfterAudio(original, processed, SR, 0, [{ start: 0, end: 10 }]);
  assert.equal(split, 4);
  const before = audio[0].slice(0, SR * 3.9);
  const after = audio[0].slice(SR * 4.1);
  // antes: é o original (220 Hz), subido ao volume do tratado
  assert.ok(Math.abs(integratedLoudness([before], SR) - integratedLoudness(processed, SR)) < 1.5);
  let diff = 0;
  for (let i = 0; i < after.length; i++) diff = Math.max(diff, Math.abs(after[i] - processed[0][SR * 4.1 + i]));
  assert.ok(diff < 1e-6, "depois é o tratado");
});
