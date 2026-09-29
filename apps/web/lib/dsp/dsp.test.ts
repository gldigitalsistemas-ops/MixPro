import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { presetChainSchema } from "@mixpro/contracts";
import { eqPeak, highpass } from "./filters";
import { compressor, limiter } from "./dynamics";
import { integratedLoudness, samplePeak } from "./loudness";
import { saturation } from "./tone";
import { finalizeForSocial, runChain, type ChainDoc } from "./chain";
import type { Signal } from "./types";

const SR = 48000;

function sine(freq: number, amp: number, seconds: number, channels = 2): Signal {
  const n = Math.round(seconds * SR);
  return Array.from({ length: channels }, () => {
    const ch = new Float32Array(n);
    for (let i = 0; i < n; i++) ch[i] = amp * Math.sin((2 * Math.PI * freq * i) / SR);
    return ch;
  });
}

function noise(seconds: number, amp = 0.3): Signal {
  let seed = 1;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
  const n = Math.round(seconds * SR);
  return [0, 1].map(() => Float32Array.from({ length: n }, () => rnd() * amp));
}

/** Nível RMS (dB) da segunda metade, depois dos transitórios. */
function rmsDb(x: Signal): number {
  const ch = x[0];
  let s = 0;
  const from = Math.floor(ch.length / 2);
  for (let i = from; i < ch.length; i++) s += ch[i] * ch[i];
  return 10 * Math.log10(s / (ch.length - from));
}

test("LUFS: seno 1 kHz a -20 dBFS em estéreo mede -20 LUFS (BS.1770)", () => {
  assert.ok(Math.abs(integratedLoudness(sine(1000, 0.1, 5), SR) - -20) < 0.15);
});

test("LUFS: silêncio retorna -Infinity", () => {
  assert.equal(integratedLoudness([new Float32Array(SR * 2)], SR), -Infinity);
});

test("Passa-altas 80 Hz 12 dB/oct: -12,3 dB em 40 Hz e ~0 dB em 1 kHz", () => {
  const ref = rmsDb(sine(40, 0.5, 2));
  const low = rmsDb(highpass(sine(40, 0.5, 2), SR, { frequency_hz: 80, slope_db_oct: "12" }));
  assert.ok(Math.abs(low - ref - -12.3) < 0.3, `atenuação ${low - ref}`);
  const hi = rmsDb(highpass(sine(1000, 0.5, 1), SR, { frequency_hz: 80, slope_db_oct: "12" }));
  assert.ok(Math.abs(hi - rmsDb(sine(1000, 0.5, 1))) < 0.05);
});

test("EQ peak +6 dB em 1 kHz", () => {
  const out = rmsDb(eqPeak(sine(1000, 0.1, 1), SR, { frequency_hz: 1000, gain_db: 6, q: 1 }));
  assert.ok(Math.abs(out - rmsDb(sine(1000, 0.1, 1)) - 6) < 0.1);
});

test("Limiter nunca passa do teto", () => {
  const out = limiter(sine(100, 1, 1), SR, { ceiling_db: -1, input_gain_db: 6, release_ms: 60, lookahead_ms: 5 });
  assert.ok(samplePeak(out) <= 10 ** (-1 / 20) + 1e-6);
});

test("Compressor 4:1 reduz ~15 dB um sinal 20 dB acima do threshold", () => {
  const ref = rmsDb(sine(1000, 1, 1));
  const out = rmsDb(
    compressor(sine(1000, 1, 1), SR, { threshold_db: -20, ratio: 4, attack_ms: 1, release_ms: 50, knee_db: 0, makeup_db: 0 }),
  );
  assert.ok(out - ref < -12 && out - ref > -17, `redução ${out - ref}`);
});

test("Oversampling sem atraso: saturação leve em sinal baixo ≈ identidade", () => {
  const src = sine(1000, 0.01, 0.5);
  const out = saturation(sine(1000, 0.01, 0.5), SR, { mode: "tape", drive_db: 0, mix: 100, output_db: 0 });
  let err = 0;
  for (let i = 200; i < src[0].length - 200; i++) err = Math.max(err, Math.abs(out[0][i] - src[0][i]));
  assert.ok(err < 2e-4, `erro ${err}`);
});

test("Ajuste para redes chega perto de -14 LUFS com pico ≤ -1 dBFS", () => {
  const out = finalizeForSocial(noise(6, 0.05), SR);
  assert.ok(Math.abs(integratedLoudness(out, SR) - -14) < 1);
  assert.ok(samplePeak(out) <= 10 ** (-1 / 20) + 1e-6);
});

test("Todos os presets do seed são válidos e produzem áudio finito", () => {
  const sql = readFileSync(
    fileURLToPath(new URL("../../../../supabase/migrations/20260924000011_presets_seed.sql", import.meta.url)),
    "utf8",
  );
  const chains = [...sql.matchAll(/'(\{"schema_version":1,"chain":\[[\s\S]*?\]\})'/g)].map((m) => JSON.parse(m[1]));
  assert.equal(chains.length, 44);
  for (const doc of chains) {
    presetChainSchema.parse(doc);
    for (const intensity of [25, 100]) {
      const out = runChain(noise(1.5), SR, doc as ChainDoc, intensity);
      const peak = samplePeak(out);
      assert.ok(Number.isFinite(peak) && peak < 4, `pico ${peak}`);
    }
  }
});

test("Reamostragem 44,1 → 48 → 44,1 kHz preserva o sinal (erro < -80 dB) e o comprimento", async () => {
  const { resample } = await import("./resample");
  const sr = 44100;
  const x = new Float32Array(sr);
  for (let i = 0; i < sr; i++) x[i] = 0.5 * Math.sin((2 * Math.PI * 1000 * i) / sr) + 0.3 * Math.sin((2 * Math.PI * 7919 * i) / sr);
  const y = resample(resample(x, 44100, 48000), 48000, 44100);
  assert.equal(y.length, x.length);
  let err = 0;
  for (let i = 2000; i < sr - 2000; i++) err = Math.max(err, Math.abs(y[i] - x[i]));
  assert.ok(20 * Math.log10(err) < -80, `erro ${err}`);
});
