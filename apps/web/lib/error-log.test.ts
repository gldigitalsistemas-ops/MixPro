import { test } from "node:test";
import assert from "node:assert/strict";
import { detectEnv, probableCause } from "./error-log";

const UA = {
  chromeIos: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/129.0.6668.69 Mobile/15E148 Safari/604.1",
  safariIos: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1",
  instagram: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 345.0.0.0",
  samsung: "Mozilla/5.0 (Linux; Android 14; SM-S911B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0.0.0 Mobile Safari/537.36",
  chromeAndroid: "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36",
};

test("navegador e sistema: no iPhone todo navegador é motor Safari", () => {
  assert.deepEqual(detectEnv(UA.chromeIos), { browser: "Chrome 129 (motor Safari)", os: "iOS 17.5", device: "iPhone", inApp: null });
  assert.equal(detectEnv(UA.safariIos).browser, "Safari 18 (motor Safari)");
  assert.equal(detectEnv(UA.instagram).inApp, "Instagram");
  assert.equal(detectEnv(UA.samsung).browser, "Samsung Internet 25");
  assert.equal(detectEnv(UA.samsung).device, "SM-S911B");
  assert.equal(detectEnv(UA.chromeAndroid).device, "Android");
  assert.equal(detectEnv(UA.chromeAndroid).os, "Android 10");
});

test("causa provável a partir da mensagem", () => {
  const env = detectEnv(UA.chromeIos);
  assert.match(probableCause("RangeError: Array buffer allocation failed", "exportar", "erro", env), /memória/);
  assert.match(probableCause("ChunkLoadError: Loading chunk 12 failed", "app", "erro", env), /versão antiga/);
  assert.match(probableCause("TypeError: Failed to fetch", "legendas", "erro", env), /Internet/);
  assert.match(probableCause("A página fechou", "gerar legendas", "queda", detectEnv(UA.instagram)), /Instagram/);
  assert.match(probableCause("x is not a function", "app", "erro", env), /Erro inesperado/);
  assert.match(probableCause("NotFoundError: The object can not be found here.", "abrir-arquivo", "erro", env), /cópia temporária/);
});
