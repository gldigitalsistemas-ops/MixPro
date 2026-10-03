import { test } from "node:test";
import assert from "node:assert/strict";
import { fnv36, fnvHex, signalFingerprint } from "./hash";

// cópias LITERAIS das funções antigas (antes da unificação)
function exportPanelFnv(text: string): string {
  let h = 0x811c9dc5;
  for (const ch of text) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}
function vsFnv(text: string): string {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return (h >>> 0).toString(36);
}

const SAMPLES = [
  "",
  "a",
  "video.mp4|12345|1700000000000",
  "Gravação do culto 🎤.mov|99|1",
  "😀😀😀",
  "ação, coração, pão — “aspas”",
  JSON.stringify([[["0.12", "2.35"]], "9:16", "blur", true, 0, 0, ["trilha.mp3", "media"], 0, ["Siga", "@x"], 0]),
  "\u{1F3B6}́‍",
];

test("fnvHex == fnv antigo do export-panel; fnv36 == fnv antigo do VS (inclusive com emoji)", () => {
  for (const s of SAMPLES) {
    assert.equal(fnvHex(s), exportPanelFnv(s), s);
    assert.equal(fnv36(s), vsFnv(s), s);
  }
  // as duas variantes NÃO são iguais (por isso as duas continuam existindo)
  assert.notEqual(fnvHex("😀"), fnv36("😀"));
});

test("signalFingerprint: depende do conteúdo e do tamanho, não de mais nada", () => {
  const a = new Float32Array(48000).map((_, i) => Math.sin(i / 10));
  const b = a.slice();
  assert.equal(signalFingerprint([a]), signalFingerprint([b]));
  b[24000] += 0.001;
  assert.notEqual(signalFingerprint([a]), signalFingerprint([b]));
  assert.notEqual(signalFingerprint([a]), signalFingerprint([a, a]));
  assert.match(signalFingerprint([a]), /^[0-9a-f]{8}$/);
});
