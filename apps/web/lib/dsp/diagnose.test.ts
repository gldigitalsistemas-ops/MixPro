import { test } from "node:test";
import assert from "node:assert/strict";
import { diagnose, measureAudio, truePeak } from "./diagnose";
import { integratedLoudness } from "./loudness";
import type { Signal } from "./types";

const SR = 16000;
const sine = (hz: number, amp: number, s: number): Float32Array<ArrayBuffer> => {
  const x = new Float32Array(SR * s);
  for (let i = 0; i < x.length; i++) x[i] = amp * Math.sin((2 * Math.PI * hz * i) / SR);
  return x;
};
const status = (fs: ReturnType<typeof diagnose>, id: string) => fs.find((f) => f.id === id)?.status;

test("seno de 0,5 de amplitude: pico, RMS e LUFS conferem com a matemática", () => {
  const sig: Signal = [sine(1000, 0.5, 6)];
  const m = measureAudio(sig, SR);
  assert.ok(Math.abs(m.peakDb - 20 * Math.log10(0.5)) < 0.05);
  assert.ok(Math.abs(m.rmsDb - (20 * Math.log10(0.5) - 3.01)) < 0.1);
  assert.equal(m.lufs, integratedLoudness(sig, SR));
  assert.equal(m.channels, 1);
  assert.equal(m.balanceDb, null);
  assert.equal(m.clipping, 0);
});

test("true peak é maior ou igual ao pico de amostra e alcança o pico real entre amostras", () => {
  // seno em fs/4 com fase 45°: todas as amostras valem ±0,7071 mas o pico real é 1,0
  const x = new Float32Array(SR);
  for (let i = 0; i < x.length; i++) x[i] = Math.sin((Math.PI / 2) * i + Math.PI / 4);
  const tp = truePeak([x]);
  const peak = Math.max(...x.map(Math.abs));
  assert.ok(Math.abs(peak - Math.SQRT1_2) < 1e-3);
  assert.ok(tp > 0.98 && tp < 1.02, `true peak ${tp}`);
  const m = measureAudio([x], SR);
  assert.ok(m.truePeakDb > m.peakDb + 2.5);
});

test("silêncio: sem NaN, tudo medido e sem LUFS", () => {
  const m = measureAudio([new Float32Array(SR * 3)], SR);
  assert.equal(m.lufs, null);
  assert.equal(m.truePeakDb < -100, true);
  assert.ok(m.silence > 0.9);
  for (const v of Object.values(m.bands)) assert.ok(Number.isFinite(v));
  const d = diagnose(m);
  assert.equal(status(d, "silence"), "warn");
  assert.equal(status(d, "level"), "warn");
});

test("clipping: onda cortada acusa 'bad'; sinal limpo não", () => {
  const clipped = sine(220, 3, 3).map((v) => Math.max(-1, Math.min(1, v)));
  assert.equal(status(diagnose(measureAudio([clipped], SR)), "clipping"), "bad");
  assert.equal(status(diagnose(measureAudio([sine(220, 0.4, 3)], SR)), "clipping"), "ok");
});

test("DC offset é detectado", () => {
  const x = sine(300, 0.2, 3).map((v) => v + 0.05);
  const m = measureAudio([x], SR);
  assert.ok(Math.abs(m.dcOffset - 0.05) < 0.002);
  assert.equal(status(diagnose(m), "dc"), "warn");
});

test("estéreo: balanço e fases opostas", () => {
  const l = sine(500, 0.5, 3);
  const quiet = l.map((v) => v * 0.25) as Float32Array<ArrayBuffer>;
  const m = measureAudio([l, quiet], SR);
  assert.ok(Math.abs((m.balanceDb ?? 0) - 12.04) < 0.1);
  assert.equal(status(diagnose(m), "stereo"), "warn");
  const inv = l.map((v) => -v) as Float32Array<ArrayBuffer>;
  const mi = measureAudio([l, inv], SR);
  assert.ok((mi.correlation ?? 0) < -0.99);
  assert.equal(status(diagnose(mi), "stereo"), "bad");
  assert.equal(status(diagnose(measureAudio([l, l.slice()], SR)), "stereo"), "ok");
});

test("bandas: um seno de 100 Hz cai na faixa de graves; um de 4 kHz, nos médio-agudos", () => {
  const a = measureAudio([sine(100, 0.5, 3)], SR);
  assert.ok(a.bands.low > 0.9, JSON.stringify(a.bands));
  const b = measureAudio([sine(4000, 0.5, 3)], SR);
  assert.ok(b.bands.highMid > 0.9, JSON.stringify(b.bands));
  assert.equal(status(diagnose(a), "bass"), "warn");
  assert.equal(status(diagnose(a, { instrument: "baixo" }), "bass"), "ok");
});

test("volume: sinal baixo é sinalizado; mono e estéreo funcionam", () => {
  const m = measureAudio([sine(800, 0.01, 6)], SR);
  assert.equal(status(diagnose(m), "level"), "bad");
});

test("LRA só existe com mais de 10 s e é pequena para tom constante", () => {
  assert.equal(measureAudio([sine(800, 0.3, 5)], SR).lra, null);
  const m = measureAudio([sine(800, 0.3, 20)], SR);
  assert.ok(m.lra !== null && m.lra < 1, `lra ${m.lra}`);
});
