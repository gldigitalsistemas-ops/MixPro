"use client";

/**
 * Amostra quadros do vídeo (sem tocar o vídeo): usados para a correção automática de cor e
 * para escolher os melhores quadros para a capa.
 */
import { ALL_FORMATS, BlobSource, CanvasSink, Input } from "mediabunny";
import { autoCorrection, frameStats, type AutoCorrection } from "./color";
import { ElementFrameReader, isDecodeFailure, markCodecsFailed, prefersElement } from "./element-frames";

export type SampledFrame = { t: number; canvas: HTMLCanvasElement | OffscreenCanvas; width: number; height: number };

/** Quadros nos instantes pedidos, com a largura `width` (altura proporcional). */
export async function sampleFrames(file: File, times: number[], width: number): Promise<SampledFrame[]> {
  if (prefersElement(file)) return sampleWithPlayer(file, times, width);
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  try {
    const track = await input.getPrimaryVideoTrack();
    if (!track) return [];
    const w = Math.max(2, Math.round(width));
    const h = Math.max(2, Math.round((width * track.displayHeight) / track.displayWidth));
    const sink = new CanvasSink(track, { width: w, height: h, fit: "fill", poolSize: 0 });
    const out: SampledFrame[] = [];
    for (const t of times) {
      const r = await sink.getCanvas(t);
      if (r) out.push({ t, canvas: r.canvas, width: w, height: h });
    }
    return out;
  } catch (err) {
    if (!isDecodeFailure(err)) throw err;
    // HEVC HDR do iPhone: o WebCodecs do Safari falha; o player do navegador consegue
    markCodecsFailed(file);
    return sampleWithPlayer(file, times, width);
  } finally {
    input.dispose();
  }
}

async function sampleWithPlayer(file: File, times: number[], width: number): Promise<SampledFrame[]> {
  const reader = await ElementFrameReader.open(file);
  try {
    const w = Math.max(2, Math.round(width));
    const h = Math.max(2, Math.round((width * reader.height) / Math.max(1, reader.width)));
    const out: SampledFrame[] = [];
    for (const t of times) {
      const canvas: SampledFrame["canvas"] = typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(w, h) : Object.assign(document.createElement("canvas"), { width: w, height: h });
      await reader.drawAt(t, canvas);
      out.push({ t, canvas, width: w, height: h });
    }
    return out;
  } finally {
    reader.close();
  }
}

function pixels(f: SampledFrame): Uint8ClampedArray | null {
  const ctx = (f.canvas as HTMLCanvasElement).getContext("2d") as CanvasRenderingContext2D | null;
  return ctx ? ctx.getImageData(0, 0, f.width, f.height).data : null;
}

/** Correção automática de cor a partir de 6 quadros espalhados pelo vídeo. */
export async function analyzeVideoColor(file: File, duration: number): Promise<AutoCorrection | null> {
  const times = [0.1, 0.25, 0.4, 0.55, 0.7, 0.85].map((p) => p * duration);
  const frames = await sampleFrames(file, times, 96);
  const stats = frames.map(pixels).filter((d): d is Uint8ClampedArray => Boolean(d)).map(frameStats);
  return stats.length ? autoCorrection(stats) : null;
}

/**
 * Nota do quadro para capa: nitidez (variância do laplaciano — sem tremido nem desfoque),
 * brilho perto do meio (nem escuro nem estourado) e um pouco de cor.
 */
export function frameScore(data: Uint8ClampedArray, w: number, h: number): number {
  const gray = new Float32Array(w * h);
  let sum = 0;
  let sat = 0;
  for (let i = 0; i < w * h; i++) {
    const r = data[i * 4];
    const g = data[i * 4 + 1];
    const b = data[i * 4 + 2];
    gray[i] = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    sum += gray[i];
    const mx = Math.max(r, g, b);
    sat += mx ? (mx - Math.min(r, g, b)) / mx : 0;
  }
  let lap = 0;
  let lap2 = 0;
  let n = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const v = 4 * gray[i] - gray[i - 1] - gray[i + 1] - gray[i - w] - gray[i + w];
      lap += v;
      lap2 += v * v;
      n++;
    }
  }
  const sharp = n ? lap2 / n - (lap / n) ** 2 : 0;
  const mean = sum / (w * h) / 255;
  const exposure = 1 - Math.min(1, Math.abs(mean - 0.48) / 0.4);
  return Math.log1p(sharp) * (0.4 + exposure) * (1 + (sat / (w * h)) * 0.5);
}

/** Os `count` melhores quadros para capa, espalhados pelo vídeo (não repete a mesma cena). */
export async function bestCoverFrames(file: File, duration: number, count = 4, width = 360): Promise<SampledFrame[]> {
  const n = 14;
  const times = Array.from({ length: n }, (_, i) => duration * (0.05 + (0.9 * i) / (n - 1)));
  const frames = await sampleFrames(file, times, width);
  const scored = frames
    .map((f) => {
      const d = pixels(f);
      return { f, s: d ? frameScore(d, f.width, f.height) : 0 };
    })
    .sort((a, b) => b.s - a.s);
  const picked: SampledFrame[] = [];
  for (const { f } of scored) {
    if (picked.every((p) => Math.abs(p.t - f.t) > duration * 0.08)) picked.push(f);
    if (picked.length === count) break;
  }
  return picked.sort((a, b) => a.t - b.t);
}
