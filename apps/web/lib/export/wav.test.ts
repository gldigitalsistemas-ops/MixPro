import { test } from "node:test";
import assert from "node:assert/strict";
import { decodeWav, encodeWavFloat } from "./wav";
import { irFromChannels, monoOf } from "@/lib/drums/asset-process";

function pcm16(samples: number[][], sampleRate: number): Uint8Array {
  const n = samples[0].length;
  const nch = samples.length;
  const out = new Uint8Array(44 + n * nch * 2);
  const v = new DataView(out.buffer);
  const str = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, "RIFF");
  v.setUint32(4, 36 + n * nch * 2, true);
  str(8, "WAVEfmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, nch, true);
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * nch * 2, true);
  v.setUint16(32, nch * 2, true);
  v.setUint16(34, 16, true);
  str(36, "data");
  v.setUint32(40, n * nch * 2, true);
  for (let i = 0, o = 44; i < n; i++) for (let c = 0; c < nch; c++, o += 2) v.setInt16(o, samples[c][i], true);
  return out;
}

test("PCM 16 bits: conversão assimétrica do Chrome (positivos ×1/32767, negativos ×1/32768, em float32)", () => {
  const w = decodeWav(pcm16([[32767, -32768, 0, 1139, -1139, 16384]], 48000));
  assert.equal(w.sampleRate, 48000);
  assert.equal(w.channels[0][0], 1);
  assert.equal(w.channels[0][1], -1);
  assert.equal(w.channels[0][2], 0);
  // valores medidos no decodeAudioData do Chrome (ver EXPORTJOB_ETAPA3.md)
  assert.equal(w.channels[0][3], Math.fround(1139 * Math.fround(1 / 32767)));
  assert.equal(w.channels[0][4], Math.fround(-1139 * Math.fround(1 / 32768)));
});

test("estéreo intercalado e float 32 sem perda (ida e volta)", () => {
  const st = decodeWav(pcm16([[100, 200], [-100, -200]], 44100));
  assert.equal(st.channels.length, 2);
  assert.ok(st.channels[0][1] > 0 && st.channels[1][1] < 0);
  const x = [new Float32Array([0.1, -0.5, 0.25]), new Float32Array([1e-7, 0.999, -1])];
  const back = decodeWav(encodeWavFloat(x, 48000));
  assert.deepEqual(back.channels, x);
});

test("WAV inválido ou formato não suportado dá erro claro", () => {
  assert.throws(() => decodeWav(new Uint8Array(64)), /não é um arquivo WAV/);
  const bad = pcm16([[1, 2]], 48000);
  new DataView(bad.buffer).setUint16(34, 8, true);
  assert.throws(() => decodeWav(bad), /não suportado/);
});

test("tratamento comum de samples/IR: mono pela média e IR com energia 1, até 250 ms", () => {
  assert.deepEqual(monoOf([new Float32Array([1, 0]), new Float32Array([0, 1])]), new Float32Array([0.5, 0.5]));
  const ir = irFromChannels([new Float32Array(48000).fill(0.1)], 48000);
  assert.equal(ir.length, 12000);
  const e = ir.reduce((s, v) => s + v * v, 0);
  assert.ok(Math.abs(e - 1) < 1e-4);
});
