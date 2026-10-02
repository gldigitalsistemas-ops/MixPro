import { test } from "node:test";
import assert from "node:assert/strict";
import { presetChainSchema } from "@mixpro/contracts";
import { ampOf, setAmp, starterChain, tabOrder, withMaster, INSTRUMENTS } from "./mix";
import { runChain } from "./dsp/chain";
import type { StudioPreset } from "./presets";

test("bases 'do zero' são cadeias válidas e rodam sem estourar", () => {
  for (const kind of [...INSTRUMENTS.map((i) => i.id), "voz" as const]) {
    const doc = starterChain(kind);
    assert.ok(presetChainSchema.safeParse(doc).success, `cadeia inválida: ${kind}`);
    if (kind === "drums") continue; // a bateria precisa dos samples carregados
    const x = new Float32Array(48000);
    for (let i = 0; i < x.length; i++) x[i] = 0.3 * Math.sin((2 * Math.PI * 220 * i) / 48000) * Math.exp(-(i % 12000) / 6000);
    const [y] = runChain([x], 48000, doc, 100);
    assert.ok(y.every(Number.isFinite), kind);
    assert.ok(Math.max(...y.map(Math.abs)) <= 1, `${kind} estourou`);
  }
  assert.ok(starterChain("guitar").chain.some((m) => m.type === "amp"));
  assert.ok(!starterChain("acoustic").chain.some((m) => m.type === "amp"));
  assert.equal(starterChain("drums").chain[0].type, "drum_studio");
});

test("amplificador: põe antes da equalização, troca e tira", () => {
  const base = { schema_version: 1, chain: [{ type: "gate", params: {} }, { type: "eq_peak", params: {} }, { type: "limiter", params: {} }] };
  const a = setAmp(base, { model: "crunch_uk", ir: "mp:g-4x12-v30" });
  assert.deepEqual(a.chain.map((m) => m.type), ["gate", "amp", "eq_peak", "limiter"]);
  assert.deepEqual(ampOf(a), { model: "crunch_uk", ir: "mp:g-4x12-v30" });
  const b = setAmp(a, { model: "hi_gain", ir: "" });
  assert.equal(b.chain.filter((m) => m.type === "amp").length, 1);
  assert.equal(ampOf(b)?.model, "hi_gain");
  assert.equal(ampOf(setAmp(b, null)), null);
});

test("master no fim: tira o limitador da mixagem e põe a cadeia do master", () => {
  const mix = { schema_version: 1, chain: [{ type: "eq_peak", params: {} }, { type: "limiter", params: {} }] };
  const master = {
    id: "m", slug: "m", name: "M", description: null, style: null, categoryId: "master-main", defaultIntensity: 50,
    chain: { schema_version: 1, chain: [{ type: "compressor", params: { ratio: { value: 3, neutral: 1 } } }, { type: "limiter", params: {} }] },
  } as StudioPreset;
  const out = withMaster(mix, master);
  assert.deepEqual(out.chain.map((m) => m.type), ["eq_peak", "compressor", "limiter"]);
  // intensidade do master já aplicada (50% entre neutro 1 e 3 = 2)
  assert.equal(out.chain[1].params?.ratio, 2);
  assert.equal(withMaster(mix, null), mix);
});

test("ordem das abas do admin: completa o que faltar e ignora o que não existe", () => {
  assert.deepEqual(tabOrder(["musica", "voz", "xyz"]), ["musica", "voz", "instrumentos", "amplificadores"]);
  assert.deepEqual(tabOrder(null), ["voz", "instrumentos", "amplificadores", "musica"]);
});
