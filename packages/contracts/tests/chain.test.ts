import { test } from "node:test";
import assert from "node:assert/strict";
import { presetChainSchema, resolveParam, MODULES } from "../src/index";

test("aceita cadeia válida com parâmetro interpolável", () => {
  const r = presetChainSchema.safeParse({
    schema_version: 1,
    chain: [
      { type: "highpass", params: { frequency_hz: 80, slope_db_oct: "12" } },
      { type: "eq_peak", label: "Mais presença", params: { frequency_hz: 4000, gain_db: { value: 4, neutral: 0 }, q: 1 } },
      { type: "compressor", params: { threshold_db: { value: -20 }, ratio: { value: 4, neutral: 1 } } },
    ],
  });
  assert.equal(r.success, true, JSON.stringify(r.error?.issues));
});

test("rejeita módulo desconhecido, parâmetro fora da faixa e parâmetro extra", () => {
  for (const chain of [
    [{ type: "vst_pago", params: {} }],
    [{ type: "gain", params: { gain_db: 99 } }],
    [{ type: "gain", params: { gain_db: 1, foo: 2 } }],
    [{ type: "highpass", params: { frequency_hz: { value: 80 } } }], // frequência não interpola
  ]) {
    assert.equal(presetChainSchema.safeParse({ schema_version: 1, chain }).success, false, JSON.stringify(chain));
  }
});

test("interpolação por intensidade", () => {
  const spec = MODULES.eq_peak.params.gain_db;
  assert.equal(resolveParam({ value: 4, neutral: 0 }, spec, 100), 4);
  assert.equal(resolveParam({ value: 4, neutral: 0 }, spec, 50), 2);
  assert.equal(resolveParam({ value: 4 }, spec, 25), 1); // neutral padrão do módulo = 0
  assert.equal(resolveParam(3, spec, 25), 3); // número puro é fixo
  assert.equal(resolveParam(undefined, spec, 50), 0);
  const ratio = MODULES.compressor.params.ratio;
  assert.equal(resolveParam({ value: 5 }, ratio, 50), 3); // neutral 1 → 1 + (5-1)*0.5
});
