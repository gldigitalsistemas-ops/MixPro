import { test } from "node:test";
import assert from "node:assert/strict";
import { mixMusic } from "./music";

const SR = 16000;
const db = (x: number) => 20 * Math.log10(x);

function rms(x: Float32Array, from: number, to: number) {
  let s = 0;
  for (let i = Math.floor(from * SR); i < to * SR; i++) s += x[i] * x[i];
  return Math.sqrt(s / ((to - from) * SR));
}

test("Música fica abaixo da voz e abaixa ~9 dB enquanto há fala", () => {
  const n = SR * 8;
  // voz: 1 s falando / 1 s em silêncio
  const voice = new Float32Array(n);
  for (let i = 0; i < n; i++) voice[i] = Math.floor(i / SR) % 2 === 0 ? 0.25 * Math.sin((2 * Math.PI * 200 * i) / SR) : 0;
  const music = new Float32Array(SR * 3);
  for (let i = 0; i < music.length; i++) music[i] = 0.2 * Math.sin((2 * Math.PI * 523 * i) / SR);

  const [mixed] = mixMusic([voice], [music], SR, "media");
  const m = mixed.map((v, i) => v - voice[i]); // só a música

  const duringSpeech = rms(m, 4.4, 4.9); // meio de um trecho com fala
  const inPause = rms(m, 5.7, 5.95); // fim de uma pausa (ducking já voltou)
  const speech = rms(voice, 4.4, 4.9);
  assert.ok(Math.abs(db(inPause / duringSpeech) - 9) < 1.5, `ducking ${db(inPause / duringSpeech)}`);
  assert.ok(Math.abs(db(inPause / speech) - -18) < 1.5, `nível ${db(inPause / speech)}`);
});

test("Fade de entrada: a música começa em silêncio", () => {
  const voice = new Float32Array(SR * 4);
  const music = new Float32Array(SR).fill(0.3);
  const [mixed] = mixMusic([voice], [music], SR, "media");
  assert.equal(mixed[0], 0);
  assert.ok(Math.abs(mixed[Math.floor(SR * 0.2)]) < Math.abs(mixed[Math.floor(SR * 1.6)]));
});
