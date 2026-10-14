import { test } from "node:test";
import assert from "node:assert/strict";
import { alignLyrics, cleanTranscript, lyricLines, partsOf, toLrc, type HeardWord } from "./lyrics";

test("transcrição: tira créditos de legenda, 'parapara', caixa alta e trechos longos quase sem palavras", () => {
  const out = cleanTranscript([
    { start: 0, end: 30, text: "A CIDADE NO BRASIL" },
    { start: 30, end: 34, text: "Agradecer-te por tua graça e bendito amor" },
    { start: 214, end: 216, text: "Paraparaparaparapara" },
    { start: 218, end: 248, text: "Legenda Adriana Zanotto" },
    { start: 250, end: 280, text: "Senhor" },
  ]);
  assert.deepEqual(out.map((s) => s.text), ["Agradecer-te por tua graça e bendito amor"]);
});

test("letra: sem marcas de seção; refrão = linhas repetidas; depois do último refrão é o final", () => {
  const lines = lyricLines("[Verse]\nÉ bom estar reunido\n\n[Chorus]\nEm tua presença\nEm tua presença\n[Bridge]\nÉ o meu lugar\n");
  assert.deepEqual(lines, ["É bom estar reunido", "Em tua presença", "Em tua presença", "É o meu lugar"]);
  assert.deepEqual(partsOf(lines), ["Estrofe", "Refrão", "Refrão", "Final"]);
  // a estrofe que volta com a mesma letra continua sendo estrofe (o refrão se repete mais)
  const song = ["A1", "A2", "R", "R", "R", "A1", "A2", "R", "R", "R", "Fim"];
  assert.deepEqual(partsOf(song), ["Estrofe", "Estrofe", "Refrão", "Refrão", "Refrão", "Estrofe", "Estrofe", "Refrão", "Refrão", "Refrão", "Final"]);
});

test("mapa: a letra certa ganha o tempo das palavras mal pronunciadas pela voz da IA", () => {
  const sung: [string, number][] = [
    ["oh", 1], ["yeah", 1.5],
    ["e", 10], ["bom", 10.4], ["estar", 10.8], ["reunido", 11.3], ["com", 12], ["os", 12.2], ["irmaos", 12.5], ["na", 13], ["casa", 13.3], ["do", 13.7], ["ceno", 14],
    ["para", 16], ["agradecerte", 16.6], ["por", 17.4], ["tua", 17.7], ["graca", 18], ["e", 18.4], ["bandido", 18.7], ["amor", 19.3],
    ["em", 30], ["tuas", 30.3], ["pecas", 30.6], ["eu", 31], ["canto", 31.3],
    ["em", 40], ["tua", 40.3], ["presenca", 40.6], ["eu", 41], ["canto", 41.3],
  ];
  const heard: HeardWord[] = sung.map(([w, t]) => ({ w, start: t, end: t + 0.3 }));
  const map = alignLyrics(
    ["É bom estar reunido com os irmãos na casa do Senhor", "Para agradecer-te por tua graça e bendito amor", "Em tua presença eu canto", "Em tua presença eu canto"],
    heard,
  );
  assert.equal(map[0].start, 10);
  assert.equal(map[1].start, 16);
  assert.equal(map[2].start, 30);
  assert.equal(map[3].start, 40);
  assert.equal(map[2].part, "Refrão");
  const lrc = toLrc(map, { title: "Teste", bpm: 116.4, key: "Sol menor" });
  assert.match(lrc, /\[re:116 BPM · Sol menor\]/);
  assert.match(lrc, /\[00:10\.00\]É bom estar reunido/);
});

test("mapa: linha sem nenhuma palavra reconhecida fica entre as vizinhas", () => {
  const heard: HeardWord[] = [
    { w: "primeira", start: 5, end: 5.5 },
    { w: "linha", start: 5.5, end: 6 },
    { w: "terceira", start: 20, end: 20.5 },
    { w: "linha", start: 20.5, end: 21 },
  ];
  const map = alignLyrics(["primeira linha", "xyzw qwert", "terceira linha"], heard);
  assert.equal(map[0].start, 5);
  assert.ok(map[1].start! > 6 && map[1].start! < 20, String(map[1].start));
  assert.equal(map[2].start, 20);
});
