import { test } from "node:test";
import assert from "node:assert/strict";
import { DELIVERY_TARGETS } from "@mixpro/contracts";
import { audioRef } from "./refs";
import { processAudio } from "./process-audio";
import { integratedLoudness } from "@/lib/dsp/loudness";
import { truePeak } from "@/lib/dsp/diagnose";
import type { Signal } from "@/lib/dsp/types";

const file = { name: "a.wav", size: 10, lastModified: 1 };
const chain = { schema_version: 1 as const, chain: [] };
const base = { file, presetSlug: "p", intensity: 100, social: true, denoise: 0, chain };

test("a chave do áudio do destino padrão é idêntica à de antes (sem destino)", () => {
  const d = DELIVERY_TARGETS.social;
  assert.equal(audioRef({ ...base, delivery: d }), audioRef(base));
});

test("destinos diferentes geram chaves diferentes; com o volume desligado o destino não conta", () => {
  const keys = new Set(Object.values(DELIVERY_TARGETS).map((d) => audioRef({ ...base, delivery: d })));
  assert.equal(keys.size, 4);
  assert.equal(audioRef({ ...base, social: false, delivery: DELIVERY_TARGETS.loud }), audioRef({ ...base, social: false }));
});

test("processAudio leva a loudness ao alvo de cada destino e respeita o teto", async () => {
  const sr = 24000;
  const make = (): Signal => {
    const x = new Float32Array(sr * 8);
    for (let i = 0; i < x.length; i++) x[i] = 0.05 * Math.sin((2 * Math.PI * 440 * i) / sr) * (0.6 + 0.4 * Math.sin((2 * Math.PI * 0.5 * i) / sr));
    return [x];
  };
  for (const id of ["natural", "podcast", "social"] as const) {
    const d = DELIVERY_TARGETS[id];
    const r = await processAudio(make(), sr, { chain, intensity: 100, social: true, delivery: d, denoise: 0, preroll: 0 });
    const lufs = integratedLoudness(r.channels, sr);
    assert.ok(Math.abs(lufs - d.targetLufs) < 1.2, `${id}: ${lufs.toFixed(2)} LUFS (alvo ${d.targetLufs})`);
    assert.ok(r.peak <= 10 ** (d.ceilingDb / 20) + 1e-6, `${id}: pico ${r.peak}`);
    assert.ok(truePeak(r.channels) < 10 ** (0.5 / 20), `${id}: true peak`);
  }
  const loud = await processAudio(make(), sr, { chain, intensity: 100, social: true, delivery: DELIVERY_TARGETS.loud, denoise: 0, preroll: 0 });
  assert.ok(loud.peak <= 10 ** (-1 / 20) + 1e-6);
  assert.ok(integratedLoudness(loud.channels, sr) > -12, "o destino 'alto' fica bem mais forte que o padrão");
});
