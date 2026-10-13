import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_PREMIUM, parsePremium, parsePremiumParams, quotePremium, ordersUnlock } from "../src/premium";

test("catálogo: ajuste inválido volta ao padrão; 1ª experiência nunca acima do preço", () => {
  const c = parsePremium({ credit_brl: -1, items: [{ id: "mix_ia", price_brl: 199, intro_brl: 999 }, { id: "vs_premium", intro_brl: null, price_brl: "abc" }] });
  assert.equal(c.credit_brl, 1);
  const mix = c.items.find((i) => i.id === "mix_ia")!;
  assert.equal(mix.price_brl, 199);
  assert.equal(mix.intro_brl, 199);
  const vs = c.items.find((i) => i.id === "vs_premium")!;
  assert.equal(vs.intro_brl, null);
  assert.equal(vs.price_brl, 39.9);
  assert.equal(parsePremium(null).items.length, DEFAULT_PREMIUM.items.length);
});

test("preço: 1ª experiência, profissional, Plano Pro e música longa", () => {
  const c = parsePremium(null);
  assert.deepEqual(quotePremium(c, "mix_ia", { introEligible: true, isPro: false }), { product: "mix_ia", price_brl: 49.9, list_price_brl: 249, intro: true, pro_discount: false, credits: null, long: false });
  const pro = quotePremium(c, "mix_ia", { introEligible: false, isPro: true })!;
  assert.equal(pro.price_brl, 199.2);
  assert.equal(pro.pro_discount, true);
  const vs = quotePremium(c, "vs_premium", { introEligible: false, isPro: false, minutes: 8 })!;
  assert.equal(vs.long, true);
  assert.equal(vs.list_price_brl, 59.85);
  assert.equal(vs.credits, 60);
  assert.equal(quotePremium(c, "vs_premium", { introEligible: false, isPro: false, minutes: 11 }), null, "acima do limite longo");
  assert.equal(quotePremium(c, "eng_finaliza", { introEligible: true, isPro: false })!.intro, false, "sem oferta de 1ª experiência");
  const off = parsePremium({ items: [{ id: "producao", enabled: false }] });
  assert.equal(quotePremium(off, "producao", { introEligible: true, isPro: false }), null);
});

test("pacote do compositor libera produção e voz; parâmetros premium validados", () => {
  assert.deepEqual(ordersUnlock("pacote_compositor"), ["producao", "voz_final"]);
  const pid = "11111111-2222-3333-4444-555555555555";
  assert.ok(parsePremiumParams("stems_premium", { project_id: pid, preview: true, format: "wav", durations: [200] }));
  assert.equal(parsePremiumParams("stems_premium", { project_id: "x", preview: true, format: "wav", durations: [200] }), null);
  const track = { name: "Voz.wav", role: "lead_vocal", gain_db: 0, pan: null, mute: false, eq_low: 0, eq_mid: 0, eq_high: 0, comp: null, reverb: null, tune: 30 };
  const mix = { project_id: pid, preview: false, format: "wav24", durations: [100, 100, 100], has_reference: true, ref_amount: 0.6, genre: "worship", align: true, tracks: [track, { ...track, name: "Baixo.wav", role: "bass", tune: 0 }], master_chain: null, master_name: null, target_lufs: -11 };
  assert.ok(parsePremiumParams("mix_ia", mix));
  assert.equal(parsePremiumParams("mix_ia", { ...mix, has_reference: false }), null, "durações não batem com as pistas");
  assert.equal(parsePremiumParams("mix_ia", { ...mix, tracks: [{ ...track, name: "../etc" }, track] }), null);
  const compose = { project_id: pid, preview: true, format: "mp3", durations: [180], has_reference: false, genre: "worship", style: "Worship moderno, pads e guitarras com delay", bpm: 72, key: "D maior", versions: 3, seed: 1 };
  assert.ok(parsePremiumParams("compose", compose));
  assert.equal(parsePremiumParams("compose", { ...compose, style: "<script>" }), null);
});

test("compose: a letra é opcional, aceita quebras de linha e recusa símbolos estranhos", () => {
  const pid = "11111111-2222-3333-4444-555555555555";
  const base = { project_id: pid, preview: true, format: "mp3", durations: [180], has_reference: false, genre: "worship", style: "", bpm: null, key: null, versions: 3, seed: 1 };
  assert.ok(parsePremiumParams("compose", base));
  assert.ok(parsePremiumParams("compose", { ...base, lyrics: "Santo, santo, santo\nÉ o Senhor!" }));
  assert.equal(parsePremiumParams("compose", { ...base, lyrics: "<script>alert(1)</script>" }), null);
  assert.equal(parsePremiumParams("compose", { ...base, lyrics: "a".repeat(2001) }), null);
});
