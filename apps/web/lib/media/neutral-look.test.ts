import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_LOOK, lookIsActive } from "./color";
import { needsRender } from "./compose";

test("vídeo começa sem tratamento de imagem: só troca o áudio (sem recodificar)", () => {
  const neutral = { ...DEFAULT_LOOK, auto: false, amount: 0, sharpen: 0, vignette: 0 };
  assert.equal(lookIsActive(neutral), false);
  assert.equal(lookIsActive({ ...neutral, correction: { saturation: 1.2, contrast: 1.1, exposure: 1.1, wb: [1, 1, 1], notes: [] } as never }), false, "correção só vale com auto ligado");
  const look = { format: "original" as const, fit: "blur" as const, watermark: false, captions: null, fontFamily: "Arial", color: neutral, cta: null };
  assert.equal(needsRender(look, false), false);
  assert.equal(lookIsActive(DEFAULT_LOOK), true, "o padrão antigo recodificava todo vídeo");
});
