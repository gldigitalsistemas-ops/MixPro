import { test } from "node:test";
import assert from "node:assert/strict";
import { editSnapshot, restorePatch } from "./edit-state";

/** Sessão gravada por uma versão antiga do app (com legendas, ferramentas de vídeo e post). */
const OLD_SNAPSHOT: Record<string, unknown> = {
  preset: { id: "p1", slug: "vocal-pop" },
  categoryId: "vocal",
  intensity: 75,
  noise: "leve",
  social: true,
  delivery: "podcast",
  captionState: { captions: [], style: "destaque", position: "bottom", burnIn: true },
  videoTools: { cut: "suave", format: "9:16", watermark: true },
  drumTweaks: null,
  reverbTweak: { size: 0.4, mix: 0.2 },
  custom: null,
  masterId: "m1",
  autoDecision: "aceito",
  niche: "musica",
  platform: "instagram",
  postEdit: "texto",
  postVariant: 2,
  tab: "legendas",
};

test("sessão antiga abre: o som volta e os campos de vídeo, legenda e post são ignorados", () => {
  const p = restorePatch(structuredClone(OLD_SNAPSHOT));
  assert.deepEqual(Object.keys(p).sort(), ["autoDecision", "categoryId", "custom", "delivery", "drumTweaks", "intensity", "masterId", "noise", "preset", "reverbTweak", "social"]);
  assert.equal(p.delivery, "podcast");
  assert.equal((p as Record<string, unknown>).videoTools, undefined);
  assert.equal((p as Record<string, unknown>).captionState, undefined);
});

test("valores com tipo errado não voltam", () => {
  const p = restorePatch({ social: "sim", delivery: "inventado", intensity: undefined });
  assert.deepEqual(p, {});
});

test("ida e volta preserva o que define o som", () => {
  const snap = editSnapshot({
    preset: null,
    categoryId: "guitarra",
    intensity: 50,
    noise: null,
    social: false,
    delivery: "loud",
    drumTweaks: null,
    reverbTweak: null,
    custom: null,
    masterId: null,
    autoDecision: "manual" as const,
  });
  assert.deepEqual(restorePatch(JSON.parse(JSON.stringify(snap))), snap);
});
