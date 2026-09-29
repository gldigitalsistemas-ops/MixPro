/** Texto do post (gancho + hashtags) a partir da fala transcrita. Tudo local, sem IA na nuvem. */

import type { Word } from "./model";

const STOP = new Set(
  (
    "a o e é de do da dos das em no na nos nas um uma uns umas para pra pro por com sem que se não nao mais menos muito muita " +
    "muitos muitas eu tu ele ela nós nos vós eles elas você voce vocês voces me te lhe meu minha meus minhas seu sua seus suas " +
    "esse essa isso este esta isto aquele aquela aquilo aqui ali lá la então entao mas ou porque porquê quando como onde quem " +
    "qual quais já ja também tambem só so até ate ao aos às as os pelo pela pelos pelas num numa foi ser estar está esta estou " +
    "estava tem ter tenho tinha vai vou vamos fazer faz fiz feito era são sao sou tá ta né ne aí ai daí dai tipo coisa coisas " +
    "gente cara agora hoje sempre nunca bem bom boa todo toda todos todas tudo nada algum alguma outro outra outros outras " +
    "mesmo mesma ainda depois antes sobre entre dia vez vezes aqui assim pode posso podem quer quero sabe sei acho acha " +
    "olha vem vai lo la the and you that this with for are was have"
  ).split(" "),
);

const plain = (w: string) =>
  w
    .toLocaleLowerCase("pt-BR")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]/g, "");

const clean = (w: string) => w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");

/** Palavras mais repetidas (sem as muito comuns), prontas para virar hashtag. */
export function keywords(words: Word[], max = 5): string[] {
  const count = new Map<string, { n: number; first: number }>();
  words.forEach((w, i) => {
    const k = plain(w.text);
    if (k.length < 4 || STOP.has(k) || /^\d+$/.test(k)) return;
    const c = count.get(k);
    if (c) c.n++;
    else count.set(k, { n: 1, first: i });
  });
  return [...count.entries()]
    .sort((a, b) => b[1].n - a[1].n || a[1].first - b[1].first)
    .slice(0, max)
    .map(([k]) => k);
}

/** Primeira frase completa da fala (até ~140 caracteres) para abrir o post. */
export function hook(words: Word[]): string {
  let text = "";
  for (const w of words) {
    const t = w.text.trim();
    if (!t) continue;
    if (text && text.length + t.length > 140) break;
    text = text ? `${text} ${t}` : t;
    if (/[.!?…]["”')]*$/.test(t) && text.length >= 25) break;
  }
  text = text.replace(/[,;:]$/, "");
  if (!text) return "";
  return text.charAt(0).toLocaleUpperCase("pt-BR") + text.slice(1) + (/[.!?…]$/.test(text) ? "" : "…");
}

const BASE_TAGS = { video: ["reels", "viral"], audio: ["musica", "audio"] };

export function buildPost(words: Word[] | null, kind: "video" | "audio"): string {
  const w = (words ?? []).map((x) => ({ ...x, text: clean(x.text) })).filter((x) => x.text);
  const tags = [...keywords(w), ...BASE_TAGS[kind]].filter((t, i, a) => a.indexOf(t) === i).slice(0, 7);
  const first = hook(words ?? []);
  const hashtags = tags.map((t) => `#${t}`).join(" ");
  return first ? `${first}\n\n${hashtags}` : hashtags;
}
