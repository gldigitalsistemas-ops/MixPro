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

/**
 * Groove de worship: chimbal em semicolcheias (acento nas colcheias), bumbo pontuado (1, "&" do 2, "&" do 3) e
 * caixa no 2 e no 4. O bumbo a cada 3 colcheias e o chimbal imitam um pulso mais rápido; o clique tem que ficar
 * no andamento e NA batida (não no contratempo, onde o bumbo também cai).
 */
function worshipGroove(bpm: number, seconds: number, sr: number): Float32Array {
  const n = Math.round(seconds * sr);
  const x = new Float32Array(n);
  let r = 0.5;
  const noise = () => (r = Math.abs(Math.sin(r * 12.9898 + 78.233) * 43758.5453) % 1) * 2 - 1;
  const hit = (t: number, kind: "kick" | "snare" | "hat", amp: number) => {
    const s0 = Math.round(t * sr);
    const len = Math.round(sr * (kind === "hat" ? 0.04 : 0.25));
    for (let k = 0; k < len && s0 + k < n; k++) {
      const env = Math.exp(-k / (sr * (kind === "kick" ? 0.08 : kind === "snare" ? 0.06 : 0.008)));
      const v = kind === "kick" ? Math.sin((2 * Math.PI * 55 * k) / sr) : kind === "snare" ? 0.6 * noise() + 0.4 * Math.sin((2 * Math.PI * 190 * k) / sr) : noise();
      x[s0 + k] += amp * env * v;
    }
  };
  const six = 60 / bpm / 4;
  for (let s = 0; s * six < seconds - 0.3; s++) {
    const pos = s % 16; // semicolcheia dentro do compasso
    hit(s * six, "hat", pos % 2 === 0 ? 0.18 : 0.1);
    if ([0, 6, 10].includes(pos)) hit(s * six, "kick", 0.9);
    if (pos === 4 || pos === 12) hit(s * six, "snare", 0.7);
  }
  return x;
}

for (const bpm of [98, 110]) {
  test(`ritmo sincopado a ${bpm} BPM: o clique fica em ${bpm} e na batida (não no contratempo)`, () => {
    const sr = 44100;
    const r = trackBeats(worshipGroove(bpm, 40, sr), sr);
    assert.ok(Math.abs(r.bpm - bpm) <= 1, `BPM ${r.bpm}`);
    // batidas no tempo (cada uma perto de um múltiplo do período)
    const p = 60 / bpm;
    const off = r.beats.map((t) => Math.abs(t - Math.round(t / p) * p));
    assert.ok(off.filter((d) => d < 0.03).length / off.length > 0.9, "batidas fora do tempo");
  });
}
