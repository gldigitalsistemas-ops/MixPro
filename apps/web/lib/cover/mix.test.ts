import { test } from "node:test";
import assert from "node:assert/strict";
import { integratedLoudness } from "@/lib/dsp/loudness";
import { coverParts, mixCover, placeOnTimeline, sumStems } from "./mix";

test("cover: o que dá para tocar depende das pistas do VS (básico e Premium)", () => {
  assert.deepEqual(coverParts(["drums", "bass", "other", "vocals"]).map((p) => [p.id, p.stems]), [["bateria", [0]], ["baixo", [1]], ["voz", [3]], ["instrumentos", [2]]]);
  const premium = coverParts(["voz", "bateria", "baixo", "guitarra", "violao", "teclado", "outros"]);
  assert.deepEqual(premium.map((p) => p.id), ["bateria", "baixo", "voz", "guitarra", "violao", "teclado"]);
  assert.equal(premium[0].chain, "drums");
});

test("cover: playback = todas as pistas menos a escolhida", () => {
  const st = (v: number) => [Int16Array.from({ length: 4 }, () => v), Int16Array.from({ length: 4 }, () => v)];
  const pb = sumStems([st(1000), st(2000), st(4000)], [0]);
  assert.ok(Math.abs(pb[0][0] - 6000 / 32768) < 1e-6);
  const only = sumStems([st(1000), st(2000), st(4000)], [], [0]);
  assert.ok(Math.abs(only[1][3] - 1000 / 32768) < 1e-6);
});

test("cover: a música entra no instante certo do vídeo (com troca de taxa)", () => {
  const x = [Float32Array.from({ length: 44100 }, (_, i) => (i === 0 ? 1 : 0))];
  const placed = placeOnTimeline(x, 44100, 48000, 1.5, 48000 * 3);
  const at = placed[0].findIndex((v) => Math.abs(v) > 0.3);
  assert.ok(Math.abs(at - 72000) <= 2, String(at));
  const early = placeOnTimeline([Float32Array.from({ length: 48000 }, (_, i) => i / 48000)], 48000, 48000, -0.5, 48000);
  assert.ok(Math.abs(early[0][0] - 0.5) < 1e-3, "a parte antes do vídeo é cortada");
});

test("cover: mix masterizada no volume do Instagram e com o equilíbrio pedido", () => {
  const sr = 48000;
  const n = sr * 6;
  const perf = [Float32Array.from({ length: n }, (_, i) => 0.3 * Math.sin((2 * Math.PI * 100 * i) / sr) * (i % 24000 < 3000 ? 1 : 0.1))];
  const music: [Float32Array<ArrayBuffer>, Float32Array<ArrayBuffer>] = [Float32Array.from({ length: n }, (_, i) => 0.05 * Math.sin((2 * Math.PI * 440 * i) / sr)), Float32Array.from({ length: n }, (_, i) => 0.05 * Math.sin((2 * Math.PI * 660 * i) / sr))];
  const a = mixCover(perf, music, sr, 0);
  assert.ok(Math.abs(a.lufs + 14) < 1, `LUFS ${a.lufs}`);
  const louder = mixCover(perf, music, sr, 6);
  assert.ok(Math.abs(20 * Math.log10(louder.musicGain / a.musicGain) - 6) < 0.01);
  assert.ok(Number.isFinite(integratedLoudness(louder.out, sr)));
});
