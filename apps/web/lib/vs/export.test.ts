import { test } from "node:test";
import assert from "node:assert/strict";
import { effectiveGains, mixdown, panMatrix, wavBlob, zipBlob, type TrackMix } from "./export";

const tone = (n: number, v: number) => Int16Array.from({ length: n }, () => v);
const base: TrackMix = { volume: 1, pan: 0, mute: false, solo: false };

test("mudo e solo", () => {
  assert.deepEqual(effectiveGains({ a: base, b: { ...base, mute: true } }), { a: 1, b: 0 });
  assert.deepEqual(effectiveGains({ a: { ...base, solo: true }, b: base, c: { ...base, solo: true, volume: 0.5 } }), { a: 1, b: 0, c: 0.5 });
});

test("pan: centro não mexe; todo à esquerda leva o canal direito para a esquerda", () => {
  assert.deepEqual(panMatrix(0).map((v) => +v.toFixed(6)), [1, 0, 0, 1]);
  assert.deepEqual(panMatrix(-1).map((v) => +v.toFixed(6)), [1, 1, 0, 0]);
  assert.deepEqual(panMatrix(1).map((v) => +v.toFixed(6)), [0, 0, 1, 1]);
});

test("mix estéreo: clique só na esquerda e música só na direita (guia de palco)", () => {
  const tracks = [
    { id: "clique", label: "Clique", left: tone(100, 8000), right: tone(100, 8000) },
    { id: "musica", label: "Música", left: tone(100, 4000), right: tone(100, 4000) },
  ];
  const { left, right } = mixdown(tracks, { clique: { ...base, pan: -1 }, musica: { ...base, pan: 1 } });
  assert.ok(left[50] > 0 && Math.abs(left[50] - 2 * 8000 * (left[50] / 16000)) < 2);
  assert.ok(left[50] / right[50] > 1.9); // clique (dobrado na esquerda) contra a música
});

test("mix que passaria do teto é abaixado por igual (sem distorcer)", () => {
  const t = (id: string) => ({ id, label: id, left: tone(10, 30000), right: tone(10, 30000) });
  const { left } = mixdown([t("a"), t("b")], { a: base, b: base });
  assert.ok(left[0] <= 32767 * 10 ** (-1 / 20) + 1);
});

test("ZIP válido com os WAVs", async () => {
  const w = wavBlob(tone(1000, 100), tone(1000, -100), 44100);
  assert.equal(w.size, 44 + 4000);
  const z = await zipBlob([{ name: "voz.wav", blob: w }, { name: "clique.wav", blob: w }]);
  const b = new Uint8Array(await z.arrayBuffer());
  const dv = new DataView(b.buffer);
  assert.equal(dv.getUint32(0, true), 0x04034b50);
  assert.equal(dv.getUint32(b.length - 22, true), 0x06054b50);
  assert.equal(dv.getUint16(b.length - 22 + 10, true), 2);
});
