import { test } from "node:test";
import assert from "node:assert/strict";
import { keptDuration, mapToOutput, speechSegments, spliceAudio } from "./cuts";

const SR = 16000;

/** 1 s de "fala" (seno), 2 s de silêncio, 1 s de fala. */
function speechWithPause() {
  const x = new Float32Array(SR * 4);
  for (let i = 0; i < x.length; i++) {
    const t = i / SR;
    if (t < 1 || t >= 3) x[i] = 0.3 * Math.sin(2 * Math.PI * 220 * t);
    else x[i] = (Math.random() - 0.5) * 0.001;
  }
  return [x];
}

test("Corte dinâmico remove a pausa longa e mantém a fala", () => {
  const segs = speechSegments(speechWithPause(), SR, 0, "dinamico", null);
  assert.equal(segs.length, 2);
  assert.ok(Math.abs(keptDuration(segs) - 2.16) < 0.1, `mantido ${keptDuration(segs)}`);
});

test("Sem cortes devolve o arquivo inteiro", () => {
  assert.deepEqual(speechSegments(speechWithPause(), SR, 0.5, "off", null), [{ start: 0.5, end: 4.5 }]);
});

test("Muletas das legendas também são cortadas", () => {
  const words = [{ text: "é…", start: 0.4, end: 0.7 }];
  const segs = speechSegments(speechWithPause(), SR, 0, "dinamico", words);
  assert.ok(segs.every((s) => s.end <= 0.37 || s.start >= 0.73));
});

test("Tempo das legendas é levado para o arquivo cortado", () => {
  const segs = [
    { start: 0, end: 1 },
    { start: 3, end: 4 },
  ];
  assert.equal(mapToOutput(segs, 0.5), 0.5);
  assert.equal(mapToOutput(segs, 2), null);
  assert.equal(mapToOutput(segs, 3.25), 1.25);
});

test("Emenda do áudio tem o tamanho dos trechos mantidos", () => {
  const out = spliceAudio(speechWithPause(), SR, 0, [
    { start: 0, end: 1 },
    { start: 3, end: 4 },
  ]);
  assert.equal(out[0].length, SR * 2);
});
