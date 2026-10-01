/** Composição de quadro (formato, enquadramento, legendas, selo, audiograma) — prévia e exportação usam a mesma. */
import { drawCaptions, type CaptionRender } from "@/lib/captions/model";
import { ColorGrader, CpuGrader, lookIsActive, type ColorLook } from "./color";

export type VideoFormat = "original" | "9:16" | "1:1" | "4:5" | "16:9";
export type Fit = "blur" | "crop";

export type Look = {
  format: VideoFormat;
  fit: Fit;
  watermark: boolean;
  captions: CaptionRender | null;
  fontFamily: string;
  /** Vídeo "antes → depois": até `split` (s, tempo do original) toca o som original. */
  beforeAfter?: { split: number } | null;
  /** Tratamento de imagem (correção automática, filtro, nitidez, vinheta). */
  color?: ColorLook | null;
  /** Chamada no final do vídeo (CTA); `start`/`end` em segundos do original. */
  cta?: EndCta | null;
};

export type EndCta = { text: string; handle: string; start: number; end: number };

/** Duração do CTA: os últimos 3,5 s (ou um quarto do vídeo, se ele for curto). */
export const ctaSeconds = (outputDuration: number) => Math.min(3.5, outputDuration * 0.25);

/**
 * Cartão da chamada final: sobe de baixo com um leve "pulo", texto grande e o @ do perfil.
 * Fica acima das legendas de baixo para não brigar com elas.
 */
export function drawEndCta(ctx: Ctx, W: number, H: number, t: number, cta: EndCta, fontFamily: string) {
  if (t < cta.start || !cta.text.trim()) return;
  const k = Math.min(1, (t - cta.start) / 0.45);
  const ease = 1 - (1 - k) ** 3;
  const m = Math.min(W, H);
  const size = Math.round(m * 0.062);
  ctx.save();
  ctx.globalAlpha = ease;
  ctx.font = `900 ${size}px ${fontFamily}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const maxW = W * 0.78;
  const lines: string[] = [];
  let cur = "";
  for (const w of cta.text.trim().split(/\s+/)) {
    const next = cur ? `${cur} ${w}` : w;
    if (cur && ctx.measureText(next).width > maxW) {
      lines.push(cur);
      cur = w;
    } else cur = next;
  }
  if (cur) lines.push(cur);
  const shown = lines.slice(0, 3);
  const lineH = size * 1.2;
  const handleSize = Math.round(size * 0.62);
  const padY = size * 0.7;
  const boxH = shown.length * lineH + (cta.handle ? handleSize * 1.6 : 0) + padY * 2;
  const boxW = Math.min(W * 0.9, Math.max(...shown.map((l) => ctx.measureText(l).width)) + size * 1.6);
  const cy = H * 0.6 + (1 - ease) * H * 0.08;
  const x = (W - boxW) / 2;
  const y = cy - boxH / 2;
  const g = ctx.createLinearGradient(x, y, x + boxW, y + boxH);
  g.addColorStop(0, "rgba(124,58,237,0.92)");
  g.addColorStop(1, "rgba(219,39,119,0.92)");
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.roundRect(x, y, boxW, boxH, size * 0.5);
  ctx.fill();
  ctx.fillStyle = "#ffffff";
  shown.forEach((l, i) => ctx.fillText(l, W / 2, y + padY + lineH / 2 + i * lineH));
  if (cta.handle) {
    ctx.font = `800 ${handleSize}px ${fontFamily}`;
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    ctx.fillText(cta.handle, W / 2, y + padY + shown.length * lineH + handleSize * 0.8);
  }
  ctx.restore();
}

let grader: ColorGrader | null | undefined;
let cpu: CpuGrader | null | undefined;
let gpuFailures = 0;

/**
 * Quadro com o tratamento de imagem aplicado (ou o próprio quadro, sem tratamento). Usa a placa de
 * vídeo (WebGL); se o sistema negar ou liberar a placa no meio do vídeo (comum no iPhone com pouca
 * memória), tenta recriar uma vez e depois segue pela CPU, sem quebrar a exportação.
 */
export function gradeFrame(src: Source, sw: number, sh: number, look: ColorLook | null | undefined): Source {
  if (!look || !lookIsActive(look)) return src;
  const w = Math.max(2, Math.round(sw));
  const h = Math.max(2, Math.round(sh));
  if (gpuFailures < 2) {
    if (grader === undefined || grader?.lost) {
      if (grader?.lost) gpuFailures++;
      grader = gpuFailures < 2 ? ColorGrader.create(w, h) : null;
      if (!grader) gpuFailures = 2;
    }
    if (grader) {
      try {
        grader.resize(w, h);
        return grader.apply(src as TexImageSource, look) as Source;
      } catch {
        gpuFailures++;
        grader = undefined;
      }
    }
  }
  if (cpu === undefined) cpu = CpuGrader.create(w, h);
  if (!cpu) return src;
  try {
    cpu.resize(w, h);
    return cpu.apply(src as CanvasImageSource, look) as Source;
  } catch {
    return src;
  }
}

export type AudiogramStyle = {
  palette: number;
  title: string;
  image: ImageBitmap | null;
};

export const PALETTES: [string, string][] = [
  ["#7c3aed", "#0b0b22"],
  ["#db2777", "#1e1b4b"],
  ["#0891b2", "#0f172a"],
  ["#ea580c", "#1c1917"],
  ["#16a34a", "#052e16"],
];

const RATIO: Record<Exclude<VideoFormat, "original">, number> = { "9:16": 9 / 16, "1:1": 1, "4:5": 4 / 5, "16:9": 16 / 9 };
const even = (v: number) => Math.max(2, Math.round(v / 2) * 2);

/** Tamanho do vídeo final: 1080 no lado menor (ou menos, se o original for menor e o formato for o original). */
export function outputSize(srcW: number, srcH: number, format: VideoFormat): { width: number; height: number } {
  if (format === "original") {
    const s = Math.min(1, 1080 / Math.min(srcW, srcH));
    return { width: even(srcW * s), height: even(srcH * s) };
  }
  const r = RATIO[format];
  return r <= 1 ? { width: 1080, height: even(1080 / r) } : { width: even(1080 * r), height: 1080 };
}

/** O vídeo precisa ser recodificado (não dá para só copiar)? */
export function needsRender(look: Look, cutting: boolean): boolean {
  return (
    cutting || look.format !== "original" || look.watermark || Boolean(look.captions) || Boolean(look.beforeAfter) || lookIsActive(look.color) || Boolean(look.cta?.text.trim())
  );
}

/** Selo "ANTES / DEPOIS" no alto do vídeo, com uma animação curta na virada. */
export function drawBeforeAfter(ctx: Ctx, W: number, H: number, t: number, split: number, fontFamily: string) {
  const after = t >= split;
  const size = Math.round(Math.min(W, H) * 0.052);
  const text = after ? "DEPOIS · COM MIX PRO" : "ANTES · SOM DO CELULAR";
  // "pulo" de 0,4 s quando vira para o depois
  const pop = after ? Math.max(0, 1 - (t - split) / 0.4) : 0;
  ctx.save();
  ctx.font = `900 ${Math.round(size * (1 + pop * 0.25))}px ${fontFamily}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const tw = ctx.measureText(text).width;
  const w = tw + size * 1.6;
  const h = size * 1.9;
  const x = (W - w) / 2;
  const y = H * 0.1;
  if (after) {
    const g = ctx.createLinearGradient(x, 0, x + w, 0);
    g.addColorStop(0, "#d946ef");
    g.addColorStop(1, "#6366f1");
    ctx.fillStyle = g;
  } else ctx.fillStyle = "rgba(20,20,20,0.78)";
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, h / 2);
  ctx.fill();
  ctx.fillStyle = "#ffffff";
  ctx.fillText(text, W / 2, y + h / 2 + size * 0.04);
  ctx.restore();
}

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
type Source = CanvasImageSource & { width?: number; height?: number };

let blurCanvas: OffscreenCanvas | null = null;

/** Fundo desfocado: reduz muito e amplia de volta (funciona em qualquer navegador, sem ctx.filter). */
function drawBlurred(ctx: Ctx, src: Source, sw: number, sh: number, W: number, H: number) {
  const bw = Math.max(8, Math.round(W / 24));
  const bh = Math.max(8, Math.round(H / 24));
  if (!blurCanvas || blurCanvas.width !== bw || blurCanvas.height !== bh) blurCanvas = new OffscreenCanvas(bw, bh);
  const b = blurCanvas.getContext("2d")!;
  const s = Math.max(bw / sw, bh / sh);
  b.imageSmoothingQuality = "high";
  b.drawImage(src, (bw - sw * s) / 2, (bh - sh * s) / 2, sw * s, sh * s);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(blurCanvas, 0, 0, W, H);
  ctx.fillStyle = "rgba(0,0,0,0.35)";
  ctx.fillRect(0, 0, W, H);
}

export function drawWatermark(ctx: Ctx, W: number, H: number, fontFamily: string) {
  const size = Math.round(Math.min(W, H) * 0.03);
  ctx.save();
  ctx.font = `800 ${size}px ${fontFamily}`;
  ctx.textBaseline = "middle";
  const text = "Feito com Mix Pro";
  const tw = ctx.measureText(text).width;
  const barsW = size * 1.1;
  const padX = size * 0.6;
  const w = tw + barsW + padX * 2.4;
  const h = size * 1.9;
  const x = W - w - W * 0.04;
  const y = H * 0.035;
  ctx.globalAlpha = 0.9;
  ctx.fillStyle = "rgba(0,0,0,0.45)";
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, h / 2);
  ctx.fill();
  const grad = ctx.createLinearGradient(x, 0, x + barsW, 0);
  grad.addColorStop(0, "#d946ef");
  grad.addColorStop(1, "#3b82f6");
  ctx.fillStyle = grad;
  [0.45, 0.9, 0.6, 0.8].forEach((f, i) => {
    const bh = h * 0.55 * f;
    ctx.fillRect(x + padX + i * (barsW / 4), y + h / 2 - bh / 2, barsW / 6, bh);
  });
  ctx.fillStyle = "#ffffff";
  ctx.fillText(text, x + padX * 1.4 + barsW, y + h / 2 + size * 0.05);
  ctx.restore();
}

/** Desenha um quadro do vídeo no formato escolhido, com legendas e selo. `t` = tempo no arquivo original. */
export function composeFrame(ctx: Ctx, W: number, H: number, raw: Source, sw: number, sh: number, t: number, look: Look) {
  const src = gradeFrame(raw, sw, sh, look.color);
  const sameShape = look.format === "original" || Math.abs(sw / sh - W / H) < 0.01;
  if (sameShape) {
    ctx.drawImage(src, 0, 0, W, H);
  } else if (look.fit === "crop") {
    const s = Math.max(W / sw, H / sh);
    ctx.drawImage(src, (W - sw * s) / 2, (H - sh * s) / 2, sw * s, sh * s);
  } else {
    drawBlurred(ctx, src, sw, sh, W, H);
    const s = Math.min(W / sw, H / sh);
    ctx.drawImage(src, (W - sw * s) / 2, (H - sh * s) / 2, sw * s, sh * s);
  }
  if (look.captions) drawCaptions(ctx, W, H, t, look.captions);
  if (look.beforeAfter) drawBeforeAfter(ctx, W, H, t, look.beforeAfter.split, look.fontFamily);
  else if (look.watermark) drawWatermark(ctx, W, H, look.fontFamily);
  if (look.cta) drawEndCta(ctx, W, H, t, look.cta, look.fontFamily);
}

/** Envelope de volume por quadro (0–1) para animar a onda do audiograma. */
export function envelope(channels: Float32Array[], sr: number, fps: number): Float32Array {
  const hop = Math.round(sr / fps);
  const frames = Math.ceil(channels[0].length / hop);
  const env = new Float32Array(frames);
  for (let f = 0; f < frames; f++) {
    let s = 0;
    const end = Math.min(channels[0].length, (f + 1) * hop);
    for (const ch of channels) for (let i = f * hop; i < end; i += 2) s += ch[i] * ch[i];
    env[f] = Math.sqrt(s / Math.max(1, ((end - f * hop) / 2) * channels.length));
  }
  const ref = Float32Array.from(env).sort()[Math.floor(frames * 0.97)] || 1;
  for (let f = 0; f < frames; f++) env[f] = Math.min(1, env[f] / ref);
  return env;
}

function wrap(ctx: Ctx, text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  let cur = "";
  for (const w of text.split(/\s+/).filter(Boolean)) {
    const next = cur ? `${cur} ${w}` : w;
    if (ctx.measureText(next).width > maxWidth && cur) {
      lines.push(cur);
      cur = w;
    } else cur = next;
  }
  if (cur) lines.push(cur);
  return lines.slice(0, 3);
}

/** Quadro do audiograma: fundo, título, onda animada, legendas e selo. `frame` indexa o envelope (tempo de saída). */
export function composeAudiogram(
  ctx: Ctx,
  W: number,
  H: number,
  frame: number,
  env: Float32Array,
  t: number,
  style: AudiogramStyle,
  look: Look,
) {
  const [c1, c2] = PALETTES[style.palette % PALETTES.length];
  if (style.image) {
    const iw = style.image.width;
    const ih = style.image.height;
    const s = Math.max(W / iw, H / ih);
    ctx.drawImage(style.image, (W - iw * s) / 2, (H - ih * s) / 2, iw * s, ih * s);
    ctx.fillStyle = "rgba(0,0,0,0.45)";
    ctx.fillRect(0, 0, W, H);
  } else {
    const g = ctx.createLinearGradient(0, 0, W * 0.4, H);
    g.addColorStop(0, c1);
    g.addColorStop(1, c2);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }

  const m = Math.min(W, H);
  if (style.title.trim()) {
    const size = Math.round(m * 0.075);
    ctx.save();
    ctx.font = `900 ${size}px ${look.fontFamily}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#ffffff";
    wrap(ctx, style.title.trim(), W * 0.84).forEach((line, i) => ctx.fillText(line, W / 2, H * 0.16 + i * size * 1.15));
    ctx.restore();
  }

  // barras espelhadas: o histórico recente do volume rola da direita para a esquerda
  const bars = 36;
  const bw = (W * 0.8) / bars;
  const cy = H * 0.5;
  const maxH = m * 0.32;
  const grad = ctx.createLinearGradient(W * 0.1, 0, W * 0.9, 0);
  grad.addColorStop(0, "#f0abfc");
  grad.addColorStop(0.5, "#ffffff");
  grad.addColorStop(1, "#93c5fd");
  ctx.fillStyle = grad;
  for (let i = 0; i < bars; i++) {
    const v = env[Math.max(0, frame - (bars - 1 - i))] ?? 0;
    const h = Math.max(m * 0.012, v * maxH);
    ctx.beginPath();
    ctx.roundRect(W * 0.1 + i * bw + bw * 0.2, cy - h / 2, bw * 0.6, h, bw * 0.3);
    ctx.fill();
  }

  if (look.captions) drawCaptions(ctx, W, H, t, look.captions);
  if (look.beforeAfter) drawBeforeAfter(ctx, W, H, t, look.beforeAfter.split, look.fontFamily);
  else if (look.watermark) drawWatermark(ctx, W, H, look.fontFamily);
  if (look.cta) drawEndCta(ctx, W, H, t, look.cta, look.fontFamily);
}
