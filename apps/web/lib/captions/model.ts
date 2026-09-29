/** Legendas: agrupamento de palavras, estilos, desenho em canvas e exportação SRT. */

export type Word = { text: string; start: number; end: number };
export type Caption = { start: number; end: number; words: Word[] };

export type CaptionStyleId = "destaque" | "classica" | "caixa" | "karaoke" | "marca" | "neon" | "emoji";
export type CaptionPosition = "top" | "middle" | "bottom";

type StyleSpec = {
  label: string;
  hint: string;
  maxWords: number;
  maxChars: number;
  uppercase: boolean;
  weight: number;
  /** Tamanho da fonte relativo ao menor lado do vídeo. */
  size: number;
  fill: string;
  /** Cor da palavra que está sendo falada (null = sem destaque). */
  active: string | null;
  /** Cor das palavras que ainda não foram faladas (karaokê). */
  upcoming?: string;
  stroke: number;
  box: string | null;
  /** Caixa colorida atrás da palavra falada (estilo "marca-texto"). */
  activeBox?: string;
  /** Brilho em volta das letras (neon). */
  glow?: string;
  /** Emoji depois das palavras-chave. */
  emoji?: boolean;
};

export const CAPTION_STYLES: Record<CaptionStyleId, StyleSpec> = {
  destaque: {
    label: "Destaque",
    hint: "Estilo Reels/TikTok",
    maxWords: 3,
    maxChars: 22,
    uppercase: true,
    weight: 900,
    size: 0.075,
    fill: "#ffffff",
    active: "#ffe500",
    stroke: 0.18,
    box: null,
  },
  marca: {
    label: "Marca-texto",
    hint: "Palavra em destaque",
    maxWords: 3,
    maxChars: 22,
    uppercase: true,
    weight: 900,
    size: 0.072,
    fill: "#ffffff",
    active: "#ffffff",
    activeBox: "#7c3aed",
    stroke: 0.14,
    box: null,
  },
  emoji: {
    label: "Emoji",
    hint: "Emoji nas palavras-chave",
    maxWords: 3,
    maxChars: 22,
    uppercase: true,
    weight: 900,
    size: 0.072,
    fill: "#ffffff",
    active: "#ffe500",
    stroke: 0.18,
    box: null,
    emoji: true,
  },
  neon: {
    label: "Neon",
    hint: "Brilho colorido",
    maxWords: 4,
    maxChars: 26,
    uppercase: true,
    weight: 800,
    size: 0.066,
    fill: "#fdf4ff",
    active: "#67e8f9",
    stroke: 0,
    box: null,
    glow: "#d946ef",
  },
  karaoke: {
    label: "Karaokê",
    hint: "Palavras acendem",
    maxWords: 5,
    maxChars: 30,
    uppercase: true,
    weight: 900,
    size: 0.064,
    fill: "#ffffff",
    active: "#4ade80",
    upcoming: "rgba(255,255,255,0.45)",
    stroke: 0.16,
    box: null,
  },
  caixa: {
    label: "Caixa",
    hint: "Fundo escuro",
    maxWords: 6,
    maxChars: 34,
    uppercase: false,
    weight: 800,
    size: 0.054,
    fill: "#ffffff",
    active: null,
    stroke: 0,
    box: "rgba(0,0,0,0.72)",
  },
  classica: {
    label: "Clássica",
    hint: "Discreta",
    maxWords: 9,
    maxChars: 44,
    uppercase: false,
    weight: 700,
    size: 0.048,
    fill: "#ffffff",
    active: null,
    stroke: 0.14,
    box: null,
  },
};

const POSITION_Y: Record<CaptionPosition, number> = { top: 0.17, middle: 0.52, bottom: 0.78 };

/** Começo da palavra (sem acento) → emoji. A ordem importa: o primeiro que casar vence. */
const EMOJI: [string, string][] = [
  ["dinheir", "💰"], ["grana", "💰"], ["lucr", "💰"], ["reais", "💰"], ["pix", "💸"],
  ["amor", "❤️"], ["amo", "❤️"], ["coracao", "❤️"], ["paix", "😍"],
  ["deus", "🙏"], ["jesus", "🙏"], ["senhor", "🙏"], ["obrigad", "🙏"], ["gratid", "🙏"], ["ora", "🙏"],
  ["louv", "🙌"], ["igreja", "⛪"], ["fe", "✨"],
  ["fogo", "🔥"], ["incrive", "🔥"], ["top", "🔥"], ["brabo", "🔥"], ["insan", "🤯"],
  ["music", "🎵"], ["cant", "🎤"], ["voz", "🎤"], ["bateri", "🥁"], ["violao", "🎸"], ["guitarr", "🎸"], ["piano", "🎹"],
  ["dica", "💡"], ["ideia", "💡"], ["segred", "🤫"], ["aprend", "📚"], ["estud", "📚"], ["livro", "📚"],
  ["sucess", "🚀"], ["cresc", "📈"], ["result", "📈"], ["meta", "🎯"], ["objetiv", "🎯"], ["foco", "🎯"],
  ["vend", "🛒"], ["client", "🤝"], ["negoci", "💼"], ["trabalh", "💼"], ["empres", "🏢"],
  ["tempo", "⏰"], ["hoje", "📅"], ["amanha", "📅"],
  ["celular", "📱"], ["video", "🎬"], ["foto", "📸"], ["internet", "🌐"], ["instagram", "📲"], ["tiktok", "📲"],
  ["casa", "🏠"], ["comid", "🍔"], ["cafe", "☕"], ["agua", "💧"], ["viag", "✈️"], ["praia", "🏖️"], ["carro", "🚗"],
  ["feliz", "😄"], ["alegr", "😄"], ["risad", "😂"], ["engracad", "😂"], ["trist", "😢"], ["medo", "😱"], ["raiva", "😡"],
  ["treino", "💪"], ["academi", "💪"], ["forc", "💪"], ["saude", "🩺"], ["dorm", "😴"], ["sono", "😴"],
  ["atenc", "⚠️"], ["cuidado", "⚠️"], ["perig", "⚠️"], ["verdade", "✅"], ["certo", "✅"], ["erro", "❌"], ["errad", "❌"],
  ["pergunt", "❓"], ["porque", "🤔"], ["pens", "🤔"], ["olha", "👀"], ["veja", "👀"],
  ["famili", "👨‍👩‍👧"], ["filh", "👶"], ["mae", "👩"], ["pai", "👨"], ["amig", "🫂"],
  ["mundo", "🌎"], ["brasil", "🇧🇷"], ["festa", "🎉"], ["parabens", "🎉"], ["presente", "🎁"],
];

const plain = (w: string) =>
  w
    .toLocaleLowerCase("pt-BR")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]/g, "");

/** Emoji para a palavra, ou null. Palavras curtas precisam ser exatas ("fe" não casa com "feira"). */
export function emojiFor(word: string): string | null {
  const w = plain(word);
  if (w.length < 2) return null;
  for (const [k, e] of EMOJI) {
    if (k.length <= 3 ? w === k || w === `${k}s` : w.startsWith(k)) return e;
  }
  return null;
}

const endsSentence = (w: string) => /[.!?…]["”')]*$/.test(w);

/** Agrupa palavras em legendas curtas, quebrando em pausas e fim de frase. */
export function buildCaptions(words: Word[], style: CaptionStyleId): Caption[] {
  const { maxWords, maxChars } = CAPTION_STYLES[style];
  const out: Caption[] = [];
  let cur: Word[] = [];
  const flush = () => {
    if (cur.length) out.push({ start: cur[0].start, end: cur[cur.length - 1].end, words: cur });
    cur = [];
  };
  for (const w of words) {
    const text = w.text.trim();
    if (!text) continue;
    const prev = cur[cur.length - 1];
    const chars = cur.reduce((n, x) => n + x.text.length + 1, 0) + text.length;
    if (prev && (cur.length >= maxWords || chars > maxChars || w.start - prev.end > 0.7)) flush();
    cur.push({ ...w, text });
    if (endsSentence(text) || (text.endsWith(",") && cur.length >= 2)) flush();
  }
  flush();
  // Mantém a legenda na tela até a próxima começar, se a pausa for curta
  for (let i = 0; i < out.length - 1; i++) {
    const gap = out[i + 1].start - out[i].end;
    if (gap > 0 && gap < 0.5) out[i].end = out[i + 1].start;
  }
  return out;
}

export const allWords = (captions: Caption[]) => captions.flatMap((c) => c.words);

/** Troca o texto de uma legenda, redistribuindo o tempo entre as novas palavras. */
export function editCaption(c: Caption, text: string): Caption {
  const parts = text.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return { ...c, words: [] };
  const total = parts.reduce((n, p) => n + p.length, 0);
  let t = c.start;
  const span = c.end - c.start;
  const words = parts.map((p) => {
    const d = (p.length / total) * span;
    const w = { text: p, start: t, end: t + d };
    t += d;
    return w;
  });
  return { ...c, words };
}

export const captionText = (c: Caption) => c.words.map((w) => w.text).join(" ");

function srtTime(s: number) {
  const ms = Math.max(0, Math.round(s * 1000));
  const p = (n: number, l = 2) => String(n).padStart(l, "0");
  return `${p(Math.floor(ms / 3600000))}:${p(Math.floor(ms / 60000) % 60)}:${p(Math.floor(ms / 1000) % 60)},${p(ms % 1000, 3)}`;
}

export function toSrt(captions: Caption[]): string {
  return captions
    .filter((c) => c.words.length)
    .map((c, i) => `${i + 1}\n${srtTime(c.start)} --> ${srtTime(c.end)}\n${captionText(c)}\n`)
    .join("\n");
}

export type CaptionRender = {
  captions: Caption[];
  style: CaptionStyleId;
  position: CaptionPosition;
  fontFamily: string;
};

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

function roundRect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Desenha a legenda do instante `t` (segundos do vídeo). Mesma função na prévia e na exportação. */
export function drawCaptions(ctx: Ctx, width: number, height: number, t: number, r: CaptionRender) {
  const cap = r.captions.find((c) => t >= c.start && t < c.end && c.words.length);
  if (!cap) return;
  const s = CAPTION_STYLES[r.style];
  const size = Math.round(s.size * Math.min(width, height));
  ctx.save();
  ctx.font = `${s.weight} ${size}px ${r.fontFamily}`;
  ctx.textBaseline = "middle";
  ctx.lineJoin = "round";

  type Token = Word & { label: string; emoji?: boolean };
  const words: Token[] = [];
  let emojiUsed = false;
  for (const w of cap.words) {
    words.push({ ...w, label: s.uppercase ? w.text.toLocaleUpperCase("pt-BR") : w.text });
    // um emoji por legenda, logo depois da primeira palavra-chave
    const e = s.emoji && !emojiUsed ? emojiFor(w.text) : null;
    if (e) {
      words.push({ text: e, label: e, start: w.end, end: w.end, emoji: true });
      emojiUsed = true;
    }
  }
  const space = ctx.measureText(" ").width;
  const maxWidth = width * 0.86;
  const lines: (typeof words)[] = [[]];
  let lineW = 0;
  for (const w of words) {
    const ww = ctx.measureText(w.label).width;
    const cur = lines[lines.length - 1];
    if (cur.length && lineW + space + ww > maxWidth) {
      lines.push([w]);
      lineW = ww;
    } else {
      cur.push(w);
      lineW += (cur.length > 1 ? space : 0) + ww;
    }
  }

  const lineH = size * 1.18;
  const top = POSITION_Y[r.position] * height - ((lines.length - 1) * lineH) / 2;
  lines.forEach((line, li) => {
    const widths = line.map((w) => ctx.measureText(w.label).width);
    const total = widths.reduce((a, b) => a + b, 0) + space * (line.length - 1);
    let x = (width - total) / 2;
    const y = top + li * lineH;
    if (s.box) {
      const padX = size * 0.35;
      const padY = size * 0.18;
      ctx.fillStyle = s.box;
      roundRect(ctx, x - padX, y - lineH / 2 - padY / 2, total + padX * 2, lineH + padY, size * 0.22);
      ctx.fill();
    }
    line.forEach((w, wi) => {
      const spoken = t >= w.start;
      const current = spoken && t < (line[wi + 1]?.start ?? lines[li + 1]?.[0]?.start ?? cap.end);
      let color = s.fill;
      if (s.upcoming && !spoken) color = s.upcoming;
      if (s.active && current) color = s.active;
      if (s.activeBox && current && !w.emoji) {
        const pad = size * 0.16;
        ctx.fillStyle = s.activeBox;
        roundRect(ctx, x - pad, y - size * 0.62, widths[wi] + pad * 2, size * 1.24, size * 0.2);
        ctx.fill();
      }
      if (s.stroke > 0 && !w.emoji) {
        ctx.lineWidth = size * s.stroke;
        ctx.strokeStyle = "#000000";
        ctx.strokeText(w.label, x, y);
      }
      ctx.fillStyle = color;
      if (s.glow && !w.emoji) {
        // duas passadas: halo largo colorido + núcleo mais nítido
        ctx.shadowColor = current && s.active ? s.active : s.glow;
        ctx.shadowBlur = size * 0.6;
        ctx.fillText(w.label, x, y);
        ctx.shadowBlur = size * 0.2;
      }
      ctx.fillText(w.label, x, y);
      ctx.shadowBlur = 0;
      x += widths[wi] + space;
    });
  });
  ctx.restore();
}
