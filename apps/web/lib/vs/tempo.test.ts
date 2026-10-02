import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { clickTrack, trackBeats } from "./tempo";

test("BPM e batidas de uma bateria real tocada com metrônomo a 90 BPM", () => {
  const b = readFileSync(fileURLToPath(new URL("../dsp/fixtures/bateria-com-clique-real.wav", import.meta.url)));
  const sr = b.readUInt32LE(24);
  const x = new Float32Array((b.length - 44) / 2);
  for (let i = 0; i < x.length; i++) x[i] = b.readInt16LE(44 + i * 2) / 32768;
  const r = trackBeats(x, sr);
  assert.ok(Math.abs(r.bpm - 90) <= 1.5, `BPM ${r.bpm}`);
  const errs = r.beats.map((t) => Math.abs(t - (0.3 + Math.round((t - 0.3) / 0.6655) * 0.6655)));
  assert.ok(errs.reduce((a, e) => a + e, 0) / errs.length < 0.035, "batidas fora do clique");
  assert.ok(r.beats.length >= 19 && r.beats.length <= 22, `${r.beats.length} batidas em 14 s`);
});

test("canal de clique: um bipe por batida, mais forte no tempo 1", () => {
  const sr = 44100;
  const c = clickTrack({ bpm: 120, beats: [0.5, 1, 1.5, 2, 2.5], downbeat: 0 }, sr * 3, sr);
  const peak = (t: number) => Math.max(...Array.from(c.subarray(Math.round(t * sr), Math.round((t + 0.03) * sr))).map(Math.abs));
  assert.ok(peak(0.5) > peak(1) && peak(2.5) > peak(2));
  assert.equal(peak(0.75), 0);
});
