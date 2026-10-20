import { test } from "node:test";
import assert from "node:assert/strict";
import { alignCover } from "./align";

/** Groove de bateria sintético: bumbo/caixa/chimbal a 116 BPM, com variações (viradas) para não ser periódico demais. */
function groove(sr: number, seconds: number, startS: number, opts: { jitterMs?: number; seed?: number; noise?: number; total?: number } = {}): Float32Array<ArrayBuffer> {
  const n = Math.round((opts.total ?? seconds + startS) * sr);
  const x = new Float32Array(n);
  let r = (opts.seed ?? 1) + 0.5;
  const rnd = () => (r = Math.abs(Math.sin(r * 12.9898 + 78.233) * 43758.5453) % 1);
  const beat = 60 / 116;
  const hit = (t: number, f: number, amp: number, decay: number) => {
    const s0 = Math.round((startS + t) * sr);
    for (let k = 0; k < sr * 0.25 && s0 + k < n; k++) {
      if (s0 + k < 0) continue;
      const env = Math.exp(-k / (sr * decay));
      x[s0 + k] += amp * env * (f > 0 ? Math.sin((2 * Math.PI * f * k) / sr) : rnd() * 2 - 1);
    }
  };
  // a mesma "partitura" (semente fixa) para o original e para a performance
  let p = 7.5;
  const score = () => (p = Math.abs(Math.sin(p * 91.7 + 3.1) * 9137.13) % 1);
  for (let b = 0; b * beat < seconds; b++) {
    const t = b * beat;
    const j = () => ((opts.jitterMs ?? 0) / 1000) * (rnd() * 2 - 1);
    if (b % 2 === 0 || score() > 0.8) hit(t + j(), 60, 0.8, 0.06);
    if (b % 2 === 1) hit(t + j(), 0, 0.5, 0.04);
    hit(t + j(), 0, 0.15, 0.01);
    if (score() > 0.7) hit(t + beat / 2 + j(), 0, 0.12, 0.01);
    if (b % 16 === 15) for (let k = 1; k < 4; k++) hit(t + (k * beat) / 4 + j(), 180 - k * 30, 0.5, 0.08);
  }
  if (opts.noise) for (let i = 0; i < n; i++) x[i] += opts.noise * (rnd() * 2 - 1);
  return x;
}

test("cover: acha onde a música começa no vídeo (gravação antes do início, taxas diferentes, timing humano)", () => {
  const ref = groove(44100, 60, 0, { seed: 3 });
  const song = Float32Array.from(ref, (v, i) => v + 0.2 * Math.sin((2 * Math.PI * 220 * i) / 44100));
  // o vídeo (48 kHz) começa 7,3 s antes da música; a pessoa toca a mesma parte com ±8 ms de variação
  const video = groove(48000, 60, 7.3, { seed: 9, jitterMs: 8, noise: 0.02 });
  const r = alignCover([video], 48000, [ref], [song], 44100);
  assert.ok(Math.abs(r.offsetS - 7.3) < 0.006, `offset ${r.offsetS}`);
  assert.ok(r.confidence >= 6, `confiança ${r.confidence}`);
});

test("cover: gravação que começou com a música já tocando (deslocamento negativo)", () => {
  const ref = groove(44100, 60, 0, { seed: 3 });
  // a música começou 12 s antes de apertar gravar
  const video = groove(48000, 60, -12, { seed: 5, jitterMs: 5, total: 40 });
  const r = alignCover([video], 48000, [ref], [ref], 44100);
  assert.ok(Math.abs(r.offsetS + 12) < 0.006, `offset ${r.offsetS}`);
});

test("cover: sem nada parecido, fica com a estimativa da gravação no app", () => {
  const ref = groove(44100, 30, 0, { seed: 3 });
  const silence = new Float32Array(48000 * 30);
  for (let i = 0; i < silence.length; i++) silence[i] = 0.001 * Math.sin(i * 0.37);
  const r = alignCover([silence], 48000, [ref], [ref], 44100, 2.4);
  assert.equal(r.by, "estimativa");
  assert.equal(r.offsetS, 2.4);
});
