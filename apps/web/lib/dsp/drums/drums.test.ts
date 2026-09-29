import { test } from "node:test";
import assert from "node:assert/strict";
import { applySections, butterworth } from "../filters";
import { reverb } from "../space";
import { runChain } from "../chain";
import { detectDrums, type Piece } from "./detect";

const SR = 48000;

/** Groove gravado "no celular": 100 bpm, bumbo 1 e 3 (+ "e" do 3), caixa 2 e 4, chimbal em colcheias, virada de tons. */
function phoneGroove() {
  const secs = 10;
  const n = SR * secs;
  const x = new Float32Array(n);
  let seed = 5;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
  const truth: { piece: Piece; t: number }[] = [];
  const beat = 60 / 100;

  const add = (t: number, gen: (i: number) => number, len: number) => {
    const s = Math.round(t * SR);
    for (let i = 0; i < len && s + i < n; i++) x[s + i] += gen(i);
  };
  const kick = (t: number) => {
    let ph = 0;
    add(t, (i) => {
      const s = i / SR;
      ph += (2 * Math.PI * (48 + 40 * Math.exp(-s / 0.03))) / SR;
      return 0.7 * Math.sin(ph) * Math.exp(-s / 0.18) + (s < 0.004 ? rnd() * 0.25 : 0);
    }, SR * 0.6);
    truth.push({ piece: "kick", t });
  };
  const snare = (t: number) => {
    add(t, (i) => {
      const s = i / SR;
      return 0.35 * Math.sin(2 * Math.PI * 190 * s) * Math.exp(-s / 0.07) + 0.45 * rnd() * Math.exp(-s / 0.15);
    }, SR * 0.5);
    truth.push({ piece: "snare", t });
  };
  const hat = (t: number) => {
    const burst = new Float32Array(Math.round(SR * 0.08));
    for (let i = 0; i < burst.length; i++) burst[i] = rnd() * Math.exp(-i / (SR * 0.02)) * 0.25;
    applySections(burst, butterworth("hp", 4, 7500, SR));
    add(t, (i) => burst[i] ?? 0, burst.length);
    truth.push({ piece: "cymbal", t });
  };
  const tom = (t: number, f: number) => {
    add(t, (i) => {
      const s = i / SR;
      return 0.6 * Math.sin(2 * Math.PI * f * (1 + 0.15 * Math.exp(-s / 0.04)) * s) * Math.exp(-s / 0.25) + (s < 0.006 ? rnd() * 0.3 * Math.exp(-s / 0.0015) : 0);
    }, SR * 0.7);
    truth.push({ piece: "tom", t });
  };

  for (let bar = 0; bar < 3; bar++) {
    const b0 = 0.25 + bar * 4 * beat;
    kick(b0);
    kick(b0 + 2 * beat);
    kick(b0 + 2.5 * beat);
    snare(b0 + beat);
    snare(b0 + 3 * beat);
    for (let e = 0; e < 8; e++) if (e !== 2 && e !== 6) hat(b0 + e * beat * 0.5);
  }
  const fill = 0.25 + 3 * 4 * beat;
  kick(fill);
  tom(fill + beat, 160);
  tom(fill + 1.5 * beat, 120);
  tom(fill + 2 * beat, 95);
  snare(fill + 3 * beat);

  // sala + microfone de celular + ruído de fundo
  let [room] = reverb([x], SR, { room_size: 45, damping: 50, width: 100, predelay_ms: 6, mix: 22 });
  room = room.slice();
  applySections(room, [...butterworth("hp", 2, 60, SR), ...butterworth("lp", 2, 14000, SR)]);
  for (let i = 0; i < n; i++) room[i] += rnd() * 0.0008;
  return { audio: [room, room.slice()], truth };
}

function score(found: number[], expected: number[], tolSec = 0.02) {
  const used = new Set<number>();
  let hitsOk = 0;
  for (const t of expected) {
    const idx = found.findIndex((f, i) => !used.has(i) && Math.abs(f - t) <= tolSec);
    if (idx >= 0) {
      used.add(idx);
      hitsOk++;
    }
  }
  return { recall: hitsOk / Math.max(1, expected.length), precision: hitsOk / Math.max(1, found.length) };
}

test("Detecta bumbo, caixa, chimbal e tons numa gravação de celular", () => {
  const { audio, truth } = phoneGroove();
  const { hits } = detectDrums(audio, SR);
  const report: Record<string, string> = {};
  for (const piece of ["kick", "snare", "cymbal", "tom"] as Piece[]) {
    const s = score(
      hits.filter((h) => h.piece === piece).map((h) => h.sample / SR),
      truth.filter((t) => t.piece === piece).map((t) => t.t),
    );
    report[piece] = `recall ${s.recall.toFixed(2)} precisão ${s.precision.toFixed(2)}`;
  }
  console.log(report);
  const k = score(hits.filter((h) => h.piece === "kick").map((h) => h.sample / SR), truth.filter((t) => t.piece === "kick").map((t) => t.t));
  const sn = score(hits.filter((h) => h.piece === "snare").map((h) => h.sample / SR), truth.filter((t) => t.piece === "snare").map((t) => t.t));
  const hh = score(hits.filter((h) => h.piece === "cymbal").map((h) => h.sample / SR), truth.filter((t) => t.piece === "cymbal").map((t) => t.t));
  assert.ok(k.recall >= 0.9 && k.precision >= 0.8, `bumbo ${JSON.stringify(k)}`);
  assert.ok(sn.recall >= 0.9 && sn.precision >= 0.8, `caixa ${JSON.stringify(sn)}`);
  assert.ok(hh.recall >= 0.8 && hh.precision >= 0.7, `chimbal ${JSON.stringify(hh)}`);
  const tm = score(hits.filter((h) => h.piece === "tom").map((h) => h.sample / SR), truth.filter((t) => t.piece === "tom").map((t) => t.t));
  // tom não encontrado só fica sem reforço; tom falso seria um som a mais: exige precisão alta
  assert.ok(tm.recall >= 0.6 && tm.precision >= 0.9, `tons ${JSON.stringify(tm)}`);
});

test("Módulo de bateria de estúdio roda na cadeia e mantém o áudio finito", () => {
  const { audio } = phoneGroove();
  for (const kit of ["worship", "poprock", "reggae", "groove", "soul", "gospel", "sertanejo"]) {
    const out = runChain(
      audio.map((c) => c.slice()),
      SR,
      { schema_version: 1, chain: [{ type: "drum_studio", params: { kit, sample_mix: { value: 70, neutral: 0 }, room: { value: 40, neutral: 0 } } }] },
      100,
    );
    let peak = 0;
    for (const ch of out) for (const v of ch) peak = Math.max(peak, Math.abs(v));
    assert.ok(Number.isFinite(peak) && peak > 0.05 && peak < 6, `${kit}: pico ${peak}`);
  }
});
