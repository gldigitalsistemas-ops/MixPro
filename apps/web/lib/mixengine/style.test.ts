import { test } from "node:test";
import assert from "node:assert/strict";
import { coverPrompt, styleDescriptors, type StyleProfile } from "./style";

const ref: StyleProfile = {
  bpm: 107,
  key: { tonic: 3, mode: "major" },
  lufs: -8.5,
  crestDb: 11,
  bands: { sub: 19, low: 45, mid: 26, presence: 6, air: 4 },
  rolloffHz: 12600,
  width: 0.08,
  arcDb: 4.5,
  stems: { drums: -4, bass: -6, other: -12, vocals: -7 },
  hitsPerBeat: 2.1,
  voice: { medianMidi: 66.5, register: "female" },
};

test("descritores da referência: bateria na frente, graves, groove e master alto", () => {
  assert.deepEqual(styleDescriptors(ref), ["punchy drum-forward mix", "big warm bass", "steady eighth-note groove", "loud polished modern master"]);
});

test("prompt do cover: fidelidade, idioma e voz da guia, tom e andamento vêm antes do estilo; nunca passa de 300", () => {
  const p = coverPrompt({ genre: "brazilian gospel, piano and organ, live drums", userStyle: "x".repeat(250), language: "pt", register: "male", bpm: 115.6, key: { tonic: 7, mode: "minor" }, reference: ref });
  assert.ok(p.length <= 300, String(p.length));
  assert.ok(p.startsWith("Faithful cover, same vocal melody, phrasing and lyrics, Brazilian Portuguese male lead vocal, native pronunciation, G minor, 116 BPM"));
  assert.ok(!p.includes("xxxx"), "a descrição longa demais fica de fora em vez de cortar o prompt no meio");
  assert.ok(p.includes("punchy drum-forward mix"));
  // a voz da referência não manda: a voz da IA segue a da guia
  assert.ok(!p.includes("female"));
});
