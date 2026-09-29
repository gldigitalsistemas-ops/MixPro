"use client";

import type { Signal } from "@/lib/dsp/types";

export const PREVIEW_SECONDS = 20;
const PREROLL_SECONDS = 1.5;

export type Excerpt = { start: number; end: number; preroll: number };

/** Trecho de ~20 s com mais energia (onde a voz/música acontece), com pré-rolagem para aquecer a dinâmica. */
export function pickExcerpt(channels: Signal, sr: number): Excerpt {
  const n = channels[0].length;
  const len = Math.round(PREVIEW_SECONDS * sr);
  if (n <= len + 5 * sr) return { start: 0, end: n, preroll: 0 };

  const win = Math.round(0.5 * sr);
  const count = Math.floor(n / win);
  const energy = new Float64Array(count);
  for (const ch of channels) {
    for (let w = 0; w < count; w++) {
      let s = 0;
      for (let i = w * win; i < (w + 1) * win; i += 4) s += ch[i] * ch[i];
      energy[w] += s;
    }
  }
  const span = Math.round(len / win);
  let sum = 0;
  for (let w = 0; w < span; w++) sum += energy[w];
  let best = sum;
  let bestW = 0;
  for (let w = span; w < count; w++) {
    sum += energy[w] - energy[w - span];
    if (sum > best) {
      best = sum;
      bestW = w - span + 1;
    }
  }
  const start = bestW * win;
  const preroll = Math.min(start, Math.round(PREROLL_SECONDS * sr));
  return { start, end: Math.min(n, start + len), preroll };
}

export function toAudioBuffer(channels: Signal, sampleRate: number): AudioBuffer {
  const buf = new AudioBuffer({ length: channels[0].length, numberOfChannels: channels.length, sampleRate });
  channels.forEach((ch, c) => buf.copyToChannel(ch, c));
  return buf;
}
