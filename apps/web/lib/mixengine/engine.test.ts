import { test } from "node:test";
import assert from "node:assert/strict";
import type { MixTrack, TrackRole } from "@mixpro/contracts";
import { integratedLoudness, samplePeak } from "@/lib/dsp/loudness";
import type { Signal } from "@/lib/dsp/types";
import { deEss, findResonances, mixSession, type EngineTrack } from "./engine";
import { scaleOf } from "./pitch";

const SR = 48000;
const S = 8;
const N = SR * S;
let seed = 3;
const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff) * 2 - 1;

function tone(fn: (t: number, i: number) => number): Float32Array<ArrayBuffer> {
  const x = new Float32Array(N);
  for (let i = 0; i < N; i++) x[i] = fn(i / SR, i);
  return x;
}
const beat = 0.5; // 120 BPM
const kick = tone((t) => {
  const p = t % beat;
  return 0.8 * Math.sin(2 * Math.PI * 58 * p) * Math.exp(-p * 18);
});
const snareRaw = tone((t) => {
  const p = (t + beat / 2) % (2 * beat);
  return p < 0.2 ? 0.5 * rnd() * Math.exp(-p * 30) + 0.3 * Math.sin(2 * Math.PI * 190 * p) * Math.exp(-p * 25) : 0;
});
const overhead = tone((_, i) => 0.25 * (snareRaw[i] ?? 0) + 0.15 * (kick[i] ?? 0) + 0.02 * rnd());
// microfone da caixa: chega 2 ms antes do overhead e com polaridade invertida
const lag = Math.round(0.002 * SR);
const snare = tone((_, i) => -(snareRaw[i + lag] ?? 0));
const bass = tone((t) => 0.4 * Math.sin(2 * Math.PI * (Math.floor(t / 2) % 2 ? 73.4 : 55) * t));
const guitar = tone((t) => {
  let v = 0;
  for (const f of [196, 247, 294, 392]) for (let h = 1; h <= 5; h++) v += Math.sin(2 * Math.PI * f * h * t) / (h * 6);
  return 0.25 * v * (0.6 + 0.4 * Math.abs(Math.sin(Math.PI * t * 2)));
});
// voz: Lá 25 centavos acima, frases com pausas
const voice = (() => {
  let ph = 0;
  return tone((t) => {
    const f = 440 * 2 ** (25 / 1200) * 2 ** ((15 / 1200) * Math.sin(2 * Math.PI * 5 * t));
    ph += (2 * Math.PI * f) / SR;
    const on = t % 2 < 1.6 ? Math.min(1, (t % 2) * 20, (1.6 - (t % 2)) * 20) : 0;
    let v = 0;
    for (let h = 1; h <= 10; h++) v += Math.sin(h * ph) / h;
    return 0.2 * on * v;
  });
})();

const track = (name: string, role: TrackRole, extra: Partial<MixTrack> = {}): MixTrack => ({ name, role, gain_db: 0, pan: null, mute: false, eq_low: 0, eq_mid: 0, eq_high: 0, comp: null, reverb: null, tune: 0, ...extra });

function session(extraVocal: Partial<MixTrack> = {}): EngineTrack[] {
  return [
    { audio: [voice.slice()] as Signal, sr: SR, user: track("Voz.wav", "lead_vocal", { tune: 100, ...extraVocal }) },
    { audio: [kick.slice()] as Signal, sr: SR, user: track("Kick.wav", "kick") },
    { audio: [snare.slice()] as Signal, sr: SR, user: track("Caixa.wav", "snare") },
    { audio: [overhead.slice(), overhead.slice()] as Signal, sr: SR, user: track("OH.wav", "overheads") },
    { audio: [bass.slice()] as Signal, sr: SR, user: track("Baixo.wav", "bass") },
    { audio: [guitar.slice()] as Signal, sr: SR, user: track("Violao.wav", "acoustic_guitar") },
  ];
}

test("mix completa: fase corrigida, voz afinada, volumes pelo papel, loudness da entrega e teto de pico", () => {
  const t0 = performance.now();
  const r = mixSession(session(), { genre: "worship", align: true, refAmount: 0, reference: null, masterChain: null, targetLufs: -11, scale: scaleOf(9, "major") });
  const ms = performance.now() - t0;
  assert.equal(r.sr, SR);
  for (const x of [r.master, r.premaster, r.instrumental, r.acapella]) {
    assert.equal(x.length, 2);
    assert.equal(x[0].length, N);
    assert.ok(x[0].every(Number.isFinite));
  }
  const lufs = integratedLoudness(r.master, SR);
  assert.ok(Math.abs(lufs - -11) < 1, `LUFS ${lufs}`);
  assert.ok(20 * Math.log10(samplePeak(r.master)) <= -0.9, "teto de pico");
  assert.ok(Math.abs(20 * Math.log10(samplePeak(r.premaster)) - -6) < 0.1, "pré-master em −6 dBFS");
  const snareD = r.decisions.find((d) => d.role === "snare")!;
  assert.equal(snareD.polarity_flipped, true, "polaridade da caixa");
  assert.ok(Math.abs(snareD.delay_ms - 2) < 0.1, `atraso ${snareD.delay_ms}`);
  const vox = r.decisions.find((d) => d.role === "lead_vocal")!;
  assert.ok(vox.tune_cents >= 15, `afinação ${vox.tune_cents}`);
  assert.ok(r.decisions.find((d) => d.role === "acoustic_guitar")!.pan !== 0, "violão sai do centro: " + JSON.stringify(r.decisions));
  // a voz fica na frente: o a capella tem loudness maior que a música menos a voz (antes do master)
  assert.equal(r.stems.length, 6);
  const voxStem = integratedLoudness(r.stems[0], SR);
  const gtrStem = integratedLoudness(r.stems[5], SR);
  assert.ok(voxStem - gtrStem > 3, `voz ${voxStem} × violão ${gtrStem}`);
  assert.ok(ms < 60_000, `tempo ${ms} ms`);
});

test("ajustes do usuário valem: mudo tira a pista; +6 dB na voz sobe a voz; referência aproxima o equilíbrio", () => {
  const base = mixSession(session(), { genre: "pop", align: false, refAmount: 0, reference: null, masterChain: null, targetLufs: -14 });
  const muted = mixSession(session({ mute: true }), { genre: "pop", align: false, refAmount: 0, reference: null, masterChain: null, targetLufs: -14 });
  assert.ok(muted.decisions[0].silent);
  assert.ok(!Number.isFinite(integratedLoudness(muted.stems[0], SR)) || integratedLoudness(muted.stems[0], SR) < -60);
  const louder = mixSession(session({ gain_db: 6 }), { genre: "pop", align: false, refAmount: 0, reference: null, masterChain: null, targetLufs: -14 });
  assert.ok(Math.abs(louder.decisions[0].gain_db - base.decisions[0].gain_db - 6) < 0.6);

  // referência com voz bem baixa e baixo bem alto: o motor caminha nessa direção
  const ref = { vocals: [voice.map((v) => v * 0.2)] as Signal, drums: [kick.slice()] as Signal, bass: [bass.map((v) => v * 2)] as Signal, other: [guitar.slice()] as Signal, sr: SR };
  const matched = mixSession(session(), { genre: "pop", align: false, refAmount: 1, reference: ref, masterChain: null, targetLufs: -14 });
  const rep = matched.report.referencia as Record<string, { volume_db: number }>;
  assert.ok(rep.bass, JSON.stringify(matched.report));
  assert.ok(rep.bass.volume_db > 0, `baixo ${rep.bass.volume_db}`);
});

test("ressonância estreita é achada; de-esser reduz sibilância sem mexer no grave", () => {
  const x = tone((t) => 0.05 * rnd() + 0.2 * Math.sin(2 * Math.PI * 1250 * t));
  const res = findResonances([x], SR);
  assert.ok(res.some((r) => Math.abs(r.f - 1250) < 30), JSON.stringify(res));
  const sib = tone((t) => 0.3 * Math.sin(2 * Math.PI * 200 * t) + (t % 1 < 0.15 ? 0.4 * rnd() : 0));
  const before = sib.slice();
  deEss([sib], SR, 8);
  let lowDiff = 0;
  for (let i = SR / 2; i < SR / 2 + 1000; i++) lowDiff = Math.max(lowDiff, Math.abs(sib[i] - before[i]));
  assert.ok(lowDiff < 0.05, "fora da sibilância quase não muda");
  let eB = 0;
  let eA = 0;
  for (let i = 0; i < 0.15 * SR; i++) {
    eB += before[i] ** 2;
    eA += sib[i] ** 2;
  }
  assert.ok(eA < eB * 0.8, "sibilância reduzida");
});
