import { test } from "node:test";
import assert from "node:assert/strict";
import { applySections, butterworth } from "@/lib/dsp/filters";
import { integratedLoudness, samplePeak } from "@/lib/dsp/loudness";
import type { Signal } from "@/lib/dsp/types";
import { octaveSpectrumDb } from "./analysis";
import { albumMaster, alignOffset, mixVoicePlayback, referenceMaster, tonalDiff } from "./mixing";

const SR = 44100;
let seed = 7;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;

/** "Música": batidas + acordes. */
function music(seconds: number, amp = 0.3): Signal {
  const x = new Float32Array(SR * seconds);
  const period = 0.5 * SR;
  for (let i = 0; i < x.length; i++) {
    const b = i % period;
    x[i] = amp * (0.6 * Math.exp(-b / (SR * 0.05)) * Math.sin((2 * Math.PI * 70 * b) / SR) + 0.15 * Math.sin((2 * Math.PI * 220 * i) / SR) + 0.1 * Math.sin((2 * Math.PI * 330 * i) / SR) + 0.05 * rnd());
  }
  return [x, x.map((v) => v * 0.95) as Float32Array<ArrayBuffer>];
}

/** "Voz": sílabas com tom. */
function voice(seconds: number): Signal {
  const x = new Float32Array(SR * seconds);
  for (let i = 0; i < x.length; i++) {
    const t = i / SR;
    if (t % 0.4 < 0.25) for (let h = 1; h <= 6; h++) x[i] += (0.12 / h) * Math.sin(2 * Math.PI * 180 * h * t);
  }
  return [x];
}

const peakDb = (x: Signal) => 20 * Math.log10(samplePeak(x));

test("alinhamento: acha o atraso da voz que captou o playback ao fundo", () => {
  const pb = music(12);
  const delay = Math.round(0.6 * SR);
  const v = new Float32Array(pb[0].length);
  for (let i = 0; i + delay < v.length; i++) v[i + delay] = 0.4 * pb[0][i] + 0.02 * rnd();
  const r = alignOffset([v], pb, SR);
  assert.ok(Math.abs(r.offsetS - 0.6) <= 0.02, JSON.stringify(r));
  assert.ok(r.confidence > 0.35);
});

test("alinhamento: sem relação entre as gravações, não inventa atraso", () => {
  const r = alignOffset(voice(10), [Float32Array.from({ length: SR * 10 }, () => 0.1 * rnd())], SR);
  assert.equal(r.offsetS, 0);
});

test("voz + playback: volume no destino, teto respeitado e voz presente na mix", () => {
  const pb = music(10);
  const v = voice(8);
  const { out, report } = mixVoicePlayback(v, pb, SR, { offsetS: 1, voiceLevelDb: 0, reverb: 30, targetLufs: -14, ceilingDb: -1 });
  assert.equal(out.length, 2);
  assert.equal(out[0].length, pb[0].length);
  assert.ok(Math.abs(integratedLoudness(out, SR) + 14) < 1, `${integratedLoudness(out, SR)}`);
  assert.ok(peakDb(out) <= -0.99);
  assert.ok(Number.isFinite(report.voz_lufs));
  // a voz (180 Hz) aparece depois de 1 s
  const spec = octaveSpectrumDb([out[0].subarray(SR * 2, SR * 6)], SR);
  const before = octaveSpectrumDb([pb[0].subarray(SR * 2, SR * 6)], SR);
  assert.ok(spec[2] - spec[5] > before[2] - before[5] - 20);
});

test("referência: timbre se aproxima da referência e o volume segue o dela", () => {
  const base = Float32Array.from({ length: SR * 8 }, () => 0.2 * rnd());
  const dark = base.slice();
  applySections(dark, butterworth("lp", 2, 1500, SR));
  const bright = Float32Array.from({ length: SR * 8 }, () => 0.3 * rnd());
  const { out, report } = referenceMaster([dark], [bright], SR, { amount: 1, ceilingDb: -1 });
  const dBefore = tonalDiff(octaveSpectrumDb([dark], SR), octaveSpectrumDb([bright], SR), 40);
  const dAfter = tonalDiff(octaveSpectrumDb(out, SR), octaveSpectrumDb([bright], SR), 40);
  const err = (d: number[]) => d.slice(2, 9).reduce((a, v) => a + Math.abs(v), 0);
  assert.ok(err(dAfter) < err(dBefore), `${err(dAfter)} < ${err(dBefore)}`);
  assert.ok(Math.abs(report.resultado_lufs - report.alvo_lufs) < 1.2);
  assert.ok(peakDb(out) <= -0.99);
});

test("álbum: todas as faixas no mesmo volume e com timbre mais parecido entre si", () => {
  const a = music(8, 0.15);
  const b0 = Float32Array.from({ length: SR * 8 }, () => 0.3 * rnd());
  const r = albumMaster([{ channels: a, sampleRate: SR }, { channels: [b0], sampleRate: SR }], { amount: 0.5, targetLufs: -14, ceilingDb: -1 });
  assert.equal(r.length, 2);
  for (const t of r) assert.ok(Math.abs(t.lufs + 14) < 1.2, `${t.lufs}`);
  const gap = (x: Signal, y: Signal) => tonalDiff(octaveSpectrumDb(x, SR), octaveSpectrumDb(y, SR), 40).slice(2, 9).reduce((s, v) => s + Math.abs(v), 0);
  assert.ok(gap(r[0].out, r[1].out) < gap(a, [b0]));
});
