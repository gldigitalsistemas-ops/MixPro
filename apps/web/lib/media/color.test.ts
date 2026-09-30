import { test } from "node:test";
import assert from "node:assert/strict";
import { autoCorrection, DEFAULT_LOOK, frameStats, lookIsActive, lookMatrix, svgMatrixValues, type ColorLook } from "./color";

const apply = (look: ColorLook, rgb: [number, number, number]) => {
  const m = lookMatrix(look);
  return [0, 1, 2].map((r) => m[r * 4] * rgb[0] + m[r * 4 + 1] * rgb[1] + m[r * 4 + 2] * rgb[2] + m[r * 4 + 3]);
};

/** Imagem RGBA de uma cor só. */
const flat = (r: number, g: number, b: number, n = 100) => {
  const d = new Uint8ClampedArray(n * 4);
  for (let i = 0; i < n; i++) d.set([r, g, b, 255], i * 4);
  return d;
};

test("Natural sem correção não mexe na imagem", () => {
  const look: ColorLook = { ...DEFAULT_LOOK, correction: null, sharpen: 0 };
  assert.deepEqual(apply(look, [0.2, 0.5, 0.8]).map((v) => +v.toFixed(6)), [0.2, 0.5, 0.8]);
  assert.equal(lookIsActive(look), false);
});

test("P&B deixa os três canais iguais; Vibrante afasta a cor do cinza", () => {
  const [r, g, b] = apply({ ...DEFAULT_LOOK, correction: null, filter: "pb" }, [0.8, 0.3, 0.2]);
  assert.ok(Math.abs(r - g) < 1e-6 && Math.abs(g - b) < 1e-6);
  const v = apply({ ...DEFAULT_LOOK, correction: null, filter: "vibrante" }, [0.6, 0.4, 0.4]);
  assert.ok(v[0] - v[1] > 0.2, `diferença ${v[0] - v[1]}`);
  // força 0 = sem filtro
  assert.deepEqual(apply({ ...DEFAULT_LOOK, correction: null, filter: "pb", amount: 0 }, [0.8, 0.3, 0.2]).map((x) => +x.toFixed(6)), [0.8, 0.3, 0.2]);
});

test("Correção automática: vídeo escuro e amarelado fica mais claro e neutro", () => {
  const c = autoCorrection([frameStats(flat(90, 75, 40))]);
  assert.ok(c.exposure > 1.2, `exposição ${c.exposure}`);
  assert.ok(c.wb[2] > c.wb[0], "azul sobe mais que o vermelho");
  const out = apply({ ...DEFAULT_LOOK, correction: c }, [90 / 255, 75 / 255, 40 / 255]);
  // menos amarelado = azul mais perto do vermelho (proporção, já que a imagem também clareou)
  assert.ok(out[2] / out[0] > 40 / 90, `azul/vermelho ${out[2] / out[0]}`);
  assert.ok(c.notes.length > 0);
  // imagem já equilibrada (cinza médio, com contraste): quase nenhuma correção
  const good = new Uint8ClampedArray(400);
  for (let i = 0; i < 100; i++) good.set(i % 2 ? [60, 60, 60, 255] : [180, 180, 180, 255], i * 4);
  const ok = autoCorrection([frameStats(good)]);
  assert.ok(Math.abs(ok.exposure - 1) < 0.1 && Math.abs(ok.wb[0] - 1) < 0.01, JSON.stringify(ok));
});

test("Matriz do filtro SVG tem 20 valores (4×5)", () => {
  assert.equal(svgMatrixValues(lookMatrix(DEFAULT_LOOK)).split(" ").length, 20);
});
