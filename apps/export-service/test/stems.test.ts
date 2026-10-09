/**
 * Separação de faixas no servidor (modelo real). Precisa de STEMS_MODEL_DIR com o modelo e do
 * onnxruntime-node instalado; sem eles é pulado (o CI testa a imagem, que traz os dois).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { separateStems, modelDir } from "../src/stems";

const ready = existsSync(join(modelDir(), "htdemucs_fwd.onnx"));
const skip = ready ? false : "sem o modelo (STEMS_MODEL_DIR)";
const SR = 44100;

test("separa bateria (batidas sem tom) de baixo (nota grave contínua)", { skip, timeout: 600_000 }, async () => {
  const n = SR * 10;
  const drums = new Float32Array(n);
  const bass = new Float32Array(n);
  let seed = 5;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
  for (let i = 0; i < n; i++) {
    const b = i % (SR / 2);
    drums[i] = 0.5 * Math.exp(-b / (SR * 0.03)) * rnd();
    bass[i] = 0.3 * Math.sin((2 * Math.PI * 55 * i) / SR);
  }
  const mix = drums.map((v, i) => v + bass[i]) as Float32Array<ArrayBuffer>;
  const t0 = Date.now();
  let last = 0;
  const st = await separateStems([mix, mix.slice()], SR, (p) => (last = p));
  const secs = (Date.now() - t0) / 1000;
  assert.equal(last, 1);
  const corr = (a: Float32Array, b: Float32Array) => {
    let ab = 0, aa = 0, bb = 0;
    for (let i = 0; i < a.length; i++) { ab += a[i] * b[i]; aa += a[i] * a[i]; bb += b[i] * b[i]; }
    return ab / Math.sqrt(aa * bb + 1e-12);
  };
  const cb = corr(st.bass[0], bass);
  const cd = corr(st.drums[0], drums);
  console.log(`# separação de 10 s em ${secs.toFixed(1)} s · corr baixo ${cb.toFixed(2)} · corr bateria ${cd.toFixed(2)}`);
  assert.ok(cb > 0.8, `baixo ${cb}`);
  assert.ok(cd > 0.6, `bateria ${cd}`);
  assert.equal(st.vocals[0].length, n);
});
