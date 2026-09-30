import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCaptions, captionText, editCaption, toSrt, type Word } from "./model";

const words = (s: string, gap = 0.3): Word[] =>
  s.split(" ").map((text, i) => ({ text, start: i * gap, end: i * gap + gap * 0.9 }));

test("Destaque: no máximo 3 palavras e quebra em vírgula e fim de frase", () => {
  const caps = buildCaptions(words("Olá pessoal, tudo bem? Hoje eu vou mostrar como fazer"), "destaque").map(captionText);
  assert.deepEqual(caps, ["Olá pessoal,", "tudo bem?", "Hoje eu vou", "mostrar como fazer"]);
});

test("Pausa longa separa as legendas", () => {
  const w: Word[] = [
    { text: "Primeira", start: 0, end: 0.4 },
    { text: "parte", start: 0.4, end: 0.8 },
    { text: "Depois", start: 2, end: 2.4 },
  ];
  assert.equal(buildCaptions(w, "classica").length, 2);
});

test("Editar mantém o intervalo de tempo e redistribui as palavras", () => {
  const [c] = buildCaptions(words("um princípio e"), "destaque");
  const e = editCaption(c, "um preset e");
  assert.equal(captionText(e), "um preset e");
  assert.equal(e.words[0].start, c.start);
  assert.ok(Math.abs(e.words[e.words.length - 1].end - c.end) < 1e-9);
});

test("SRT no formato padrão", () => {
  const srt = toSrt(buildCaptions([{ text: "Olá!", start: 1.5, end: 62.25 }], "classica"));
  assert.equal(srt, "1\n00:00:01,500 --> 00:01:02,250\nOlá!\n");
});

test("Emoji: palavra-chave com acento e plural; palavra curta só exata", async () => {
  const { emojiFor } = await import("./model");
  assert.equal(emojiFor("Dinheiro!"), "💰");
  assert.equal(emojiFor("CORAÇÃO"), "❤️");
  assert.equal(emojiFor("fé"), "✨");
  assert.equal(emojiFor("feira"), null);
  assert.equal(emojiFor("de"), null);
});

test("Post: gancho com a primeira frase e hashtags das palavras mais repetidas", async () => {
  const { buildPost } = await import("./post");
  const text = buildPost(
    words("Hoje eu vou mostrar como gravar voz no celular. O celular capta a voz muito bem, e a voz fica limpa com o Mix Pro."),
    "video",
  );
  const [first, , tags] = text.split("\n");
  assert.equal(first, "Hoje eu vou mostrar como gravar voz no celular.");
  assert.match(tags, /^#celular /);
  assert.ok(tags.includes("#reels") && !tags.includes("#muito") && !tags.includes("#voz"), tags);
  assert.equal(buildPost(null, "audio"), "#musica #audio");
});

test("Post por nicho: sem fala usa a abertura do nicho; hashtags na medida da plataforma", async () => {
  const { composePost, coverTitle } = await import("./post");
  const { nicheById } = await import("./niches");
  const bateria = nicheById("bateria");
  const ig = composePost({ words: null, mediaKind: "video", niche: bateria, platform: "instagram", variant: 0 });
  const [opening, cta, tags] = ig.split("\n\n");
  assert.ok(opening.includes("🥁") && cta.length > 5, ig);
  assert.equal(tags.split(" ").length, 5, tags);
  assert.ok(tags.includes("#reels") && tags.includes("#bateria"), tags);
  const yt = composePost({ words: null, mediaKind: "video", niche: bateria, platform: "youtube", variant: 0 });
  assert.ok(yt.endsWith("#shorts #bateria #baterista") || yt.split("\n\n")[2].split(" ").length <= 4, yt);
  // outra sugestão muda o texto
  assert.notEqual(composePost({ words: null, mediaKind: "video", niche: bateria, platform: "instagram", variant: 1 }), ig);
  // com fala: a frase dita abre o post e as palavras-chave entram nas hashtags
  const w = words("Hoje eu vou mostrar como afinar a bateria. Afinar bem muda tudo na bateria.");
  const withSpeech = composePost({ words: w, mediaKind: "video", niche: bateria, platform: "instagram", variant: 0 });
  assert.ok(withSpeech.startsWith("Hoje eu vou mostrar como afinar a bateria."), withSpeech);
  assert.ok(withSpeech.includes("#afinar"), withSpeech);
  assert.equal(coverTitle(w, bateria), "Hoje eu vou mostrar como…");
  assert.equal(coverTitle(null, bateria), "Groove pesado");
});
