import { test } from "node:test";
import assert from "node:assert/strict";
import { applySections, butterworth } from "../filters";
import { reverb } from "../space";
import { runChain } from "../chain";
import { detectDrums, type Piece } from "./detect";

const SR = 48000;

/** Groove gravado "no celular": 100 bpm, bumbo 1 e 3 (+ "e" do 3), caixa 2 e 4, chimbal em colcheias, virada de tons. */
function phoneGroove(opts: { metronome?: boolean } = {}) {
  const secs = opts.metronome ? 13 : 10;
  // com metrônomo, a gravação começa com a contagem (4 cliques sozinhos) antes da bateria
  const start = opts.metronome ? 0.25 + 4 * (60 / 100) : 0.25;
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
    const b0 = start + bar * 4 * beat;
    kick(b0);
    kick(b0 + 2 * beat);
    kick(b0 + 2.5 * beat);
    snare(b0 + beat);
    snare(b0 + 3 * beat);
    for (let e = 0; e < 8; e++) if (e !== 2 && e !== 6) hat(b0 + e * beat * 0.5);
  }
  const fill = start + 3 * 4 * beat;
  kick(fill);
  tom(fill + beat, 160);
  tom(fill + 1.5 * beat, 120);
  tom(fill + 2 * beat, 95);
  snare(fill + 3 * beat);

  // metrônomo vazando do fone/caixinha: clique curto e afinado em todos os tempos, acento no 1
  if (opts.metronome) {
    for (let k = 0; k * beat + 0.25 < secs - 0.1; k++) {
      const accent = k % 4 === 0;
      const f = accent ? 2000 : 1500;
      add(0.25 + k * beat, (i) => {
        const s = i / SR;
        return (accent ? 0.3 : 0.2) * Math.exp(-s / 0.006) * (Math.sin(2 * Math.PI * f * s) + 0.5 * Math.sin(2 * Math.PI * 2 * f * s));
      }, SR * 0.04);
    }
  }

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

const drumChain = (params: Record<string, unknown>) => ({ schema_version: 1, chain: [{ type: "drum_studio", params }] });
const peakOf = (x: Float32Array[]) => x.reduce((m, ch) => ch.reduce((a, v) => Math.max(a, Math.abs(v)), m), 0);

test("Módulo de bateria de estúdio roda na cadeia e mantém o áudio finito", () => {
  const { audio } = phoneGroove();
  for (const kit of ["worship", "poprock", "reggae", "groove", "soul", "gospel", "sertanejo"]) {
    for (const reverb_size of ["small", "medium", "large"]) {
      const out = runChain(audio.map((c) => c.slice()), SR, drumChain({ kit, sample_mix: 70, reverb_size, reverb: 40 }), 100);
      const peak = peakOf(out);
      assert.ok(Number.isFinite(peak) && peak > 0.05 && peak < 6, `${kit}/${reverb_size}: pico ${peak}`);
    }
  }
});

test("Tons separados pela afinação: agudo = tom 1, médio = tom 2, grave = surdo", async () => {
  const { assignTomSlots, analyzeDrums } = await import("./studio");
  assert.deepEqual(assignTomSlots([165, 125, 98, 160]), ["tom1", "tom2", "floor", "tom1"]);
  assert.deepEqual(assignTomSlots([150, 85]), ["tom1", "floor"]);
  assert.deepEqual(assignTomSlots([150, 120]), ["tom1", "tom2"]);
  assert.deepEqual(assignTomSlots([82]), ["floor"]);
  const { counts } = analyzeDrums(phoneGroove().audio, SR);
  // a virada tem tons em 160, 120 e 95 Hz; o detector acha 2 deles (ver teste acima), cada um no seu grupo
  assert.equal(counts.tom1 + counts.tom2 + counts.floor, 2, JSON.stringify(counts));
  assert.ok(counts.kick >= 9 && counts.snare >= 7, JSON.stringify(counts));
});

test("Com samples reais carregados, o reforço usa o sample e não o timbre sintetizado", async () => {
  const { setDrumSamples } = await import("./studio");
  const { audio } = phoneGroove();
  const run = () => runChain(audio.map((c) => c.slice()), SR, drumChain({ kit: "poprock", sample_mix: 100, reverb: 0 }), 100);
  const synth = run();
  // "sample" de bumbo com um tom de 1 kHz bem reconhecível, em 3 camadas
  const layer = (amp: number) => Float32Array.from({ length: SR * 0.2 }, (_, i) => amp * Math.sin((2 * Math.PI * 1000 * i) / SR) * Math.exp(-i / (SR * 0.05)));
  setDrumSamples({ kick: [layer(0.5), layer(0.8), layer(1)] });
  const real = run();
  setDrumSamples(null);
  const band = (x: Float32Array[]) => {
    const y = x[0].slice();
    applySections(y, [...butterworth("hp", 4, 800, SR), ...butterworth("lp", 4, 1250, SR)]);
    return y.reduce((s, v) => s + v * v, 0);
  };
  assert.ok(band(real) > band(synth) * 3, `energia em 1 kHz: sample ${band(real)} x sintetizado ${band(synth)}`);
});

test("Afinação: +12 semitons = sample com metade do comprimento (uma oitava acima)", async () => {
  const { tuneSample } = await import("./studio");
  const x = Float32Array.from({ length: 4800 }, (_, i) => Math.sin((2 * Math.PI * 100 * i) / SR));
  assert.equal(tuneSample(x, 12, SR).length, 2400);
  assert.equal(tuneSample(x, -12, SR).length, 9600);
  assert.equal(tuneSample(x, 0, SR), x);
});

test("Rimshot nas caixas mais fortes e microfones de sala somados", async () => {
  const { setDrumSamples } = await import("./studio");
  const { audio } = phoneGroove();
  const tone = (f: number) => Float32Array.from({ length: SR * 0.15 }, (_, i) => Math.sin((2 * Math.PI * f * i) / SR) * Math.exp(-i / (SR * 0.04)));
  const energyAt = (x: Float32Array[], lo: number, hi: number) => {
    const y = x[0].slice();
    applySections(y, [...butterworth("hp", 4, lo, SR), ...butterworth("lp", 4, hi, SR)]);
    return y.reduce((s, v) => s + v * v, 0);
  };
  const run = (params: Record<string, unknown>) => runChain(audio.map((c) => c.slice()), SR, drumChain({ kit: "poprock", sample_mix: 100, reverb: 0, ...params }), 100);
  // caixa = 2 kHz, rimshot = 5 kHz, sala do bumbo = 700 Hz
  setDrumSamples({ snare: [tone(2000)], rimshot: [tone(5000)], kick: [tone(60)], rooms: { kick: [tone(700)] } });
  const noRim = run({ rimshot: 0, room: 0 });
  const allRim = run({ rimshot: 100, room: 0 });
  const withRoom = run({ rimshot: 0, room: 100 });
  setDrumSamples(null);
  assert.ok(energyAt(allRim, 4000, 6500) > energyAt(noRim, 4000, 6500) * 3, "rimshot usa o sample do aro");
  assert.ok(energyAt(withRoom, 550, 900) > energyAt(noRim, 550, 900) * 3, "sala entra na mistura");
});

test("Reverb: Large deixa mais cauda que Small", () => {
  const { audio } = phoneGroove();
  const tail = (reverb_size: string) => {
    const out = runChain(audio.map((c) => c.slice()), SR, drumChain({ kit: "worship", sample_mix: 70, reverb_size, reverb: 80 }), 100);
    // energia logo depois da última caixa (fim do arquivo), onde só sobra o reverb
    const from = Math.round(SR * 9.55);
    return out[0].slice(from).reduce((s, v) => s + v * v, 0);
  };
  assert.ok(tail("large") > tail("small") * 1.3, `large ${tail("large")} small ${tail("small")}`);
});

test("Metrônomo vazando na gravação é ignorado: não vira caixa nem prato", () => {
  const { audio, truth } = phoneGroove({ metronome: true });
  const { hits, metronome } = detectDrums(audio, SR);
  assert.equal(metronome, true, "metrônomo não reconhecido");
  const sn = score(hits.filter((h) => h.piece === "snare").map((h) => h.sample / SR), truth.filter((t) => t.piece === "snare").map((t) => t.t));
  assert.ok(sn.recall >= 0.85 && sn.precision >= 0.85, `caixa com metrônomo ${JSON.stringify(sn)}`);
  const kick = score(hits.filter((h) => h.piece === "kick").map((h) => h.sample / SR), truth.filter((t) => t.piece === "kick").map((t) => t.t));
  assert.ok(kick.recall >= 0.85 && kick.precision >= 0.8, `bumbo com metrônomo ${JSON.stringify(kick)}`);
});

test("Sem metrônomo, nada é tratado como metrônomo", () => {
  const { audio } = phoneGroove();
  assert.equal(detectDrums(audio, SR).metronome, false);
});
