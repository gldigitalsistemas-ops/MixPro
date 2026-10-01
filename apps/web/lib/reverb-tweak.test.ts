import { test } from "node:test";
import assert from "node:assert/strict";
import { presetChainSchema } from "@mixpro/contracts";
import { reverbFromChain, withReverb } from "./reverb-tweak";
import type { ChainDoc } from "./dsp/chain";

const limiter = { type: "limiter", params: { ceiling_db: -1, input_gain_db: 0, release_ms: 60, lookahead_ms: 5 } };

test("Preset sem reverb: começa em 0 e, ao subir, ganha um reverb antes do limiter", () => {
  const doc: ChainDoc = { schema_version: 1, chain: [{ type: "highpass", params: { frequency_hz: 80, slope_db_oct: "12" } }, limiter] };
  assert.deepEqual(reverbFromChain(doc), { size: "medium", amount: 0 });
  assert.equal(withReverb(doc, { size: "large", amount: 0 }), doc);
  const out = withReverb(doc, { size: "large", amount: 50 });
  assert.deepEqual(out.chain.map((m) => m.type), ["highpass", "reverb", "limiter"]);
  assert.equal(out.chain[1].params!.room_size, 86);
  assert.equal(presetChainSchema.safeParse(out).success, true);
  assert.deepEqual(reverbFromChain(out), { size: "large", amount: 50 });
});

test("Preset com reverb: o controle ajusta o reverb que já existe", () => {
  const doc: ChainDoc = {
    schema_version: 1,
    chain: [{ type: "reverb", params: { room_size: 40, damping: 50, width: 100, predelay_ms: 10, mix: { value: 12, neutral: 0 } } }, limiter],
  };
  assert.deepEqual(reverbFromChain(doc), { size: "small", amount: 30 });
  const out = withReverb(doc, { size: "medium", amount: 100 });
  assert.equal(out.chain.length, 2);
  assert.deepEqual(out.chain[0].params!.mix, { value: 40, neutral: 0 });
  assert.equal(presetChainSchema.safeParse(out).success, true);
});

test("Bateria de Estúdio: o controle vai para o reverb do módulo de bateria", () => {
  const doc: ChainDoc = { schema_version: 1, chain: [{ type: "drum_studio", params: { kit: "worship", reverb_size: "large", reverb: { value: 45, neutral: 0 } } }, limiter] };
  assert.deepEqual(reverbFromChain(doc), { size: "large", amount: 45 });
  const out = withReverb(doc, { size: "small", amount: 10 });
  assert.equal(out.chain.filter((m) => m.type === "reverb").length, 0);
  assert.equal(out.chain[0].params!.reverb_size, "small");
});
