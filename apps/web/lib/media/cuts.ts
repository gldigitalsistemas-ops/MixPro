/** Corte automático de pausas e muletas ("é…", "hã…"): devolve os trechos a manter. */
import type { Word } from "@/lib/captions/model";
import type { Signal } from "@/lib/dsp/types";

export type Segment = { start: number; end: number };
export type CutLevel = "off" | "suave" | "dinamico";

const LEVELS: Record<Exclude<CutLevel, "off">, { minSilence: number; pad: number }> = {
  suave: { minSilence: 0.65, pad: 0.2 },
  dinamico: { minSilence: 0.3, pad: 0.08 },
};

/** Muletas comuns em português (e "um/uh" em inglês), com ou sem pontuação. */
const FILLER = /^(h?[ãa]+h*|h?[ée]+h*|hum+|hmm+|ahn+|ãhn+|uh+m*|um+|er+m*)[.,!?…]*$/i;

export const isFiller = (w: Word) => FILLER.test(w.text.trim()) && w.end - w.start < 1.2;

/**
 * Detecta fala por energia (quadros de 20 ms) com limiar adaptativo ao nível do arquivo.
 * `offset` = instante (s) da primeira amostra no arquivo original.
 */
export function speechSegments(
  channels: Signal,
  sr: number,
  offset: number,
  level: CutLevel,
  words: Word[] | null,
): Segment[] {
  const n = channels[0].length;
  const total: Segment = { start: offset, end: offset + n / sr };
  if (level === "off") return [total];
  const { minSilence, pad } = LEVELS[level];

  const hop = Math.round(sr * 0.02);
  const frames = Math.floor(n / hop);
  const db = new Float32Array(frames);
  for (let f = 0; f < frames; f++) {
    let s = 0;
    for (const ch of channels) for (let i = f * hop; i < (f + 1) * hop; i++) s += ch[i] * ch[i];
    db[f] = 10 * Math.log10(s / (hop * channels.length) + 1e-12);
  }
  const sorted = Float32Array.from(db).sort();
  const floor = sorted[Math.floor(frames * 0.1)];
  const loud = sorted[Math.floor(frames * 0.95)];
  const threshold = Math.max(floor + 8, loud - 32);

  // trechos de fala = quadros acima do limiar, unindo pausas mais curtas que minSilence
  const minGap = Math.round(minSilence / 0.02);
  const keep: Segment[] = [];
  let start = -1;
  let lastVoiced = -1;
  for (let f = 0; f < frames; f++) {
    if (db[f] <= threshold) continue;
    if (start < 0) start = f;
    else if (f - lastVoiced > minGap) {
      keep.push({ start: start * 0.02, end: (lastVoiced + 1) * 0.02 });
      start = f;
    }
    lastVoiced = f;
  }
  if (start >= 0) keep.push({ start: start * 0.02, end: (lastVoiced + 1) * 0.02 });
  if (!keep.length) return [total];

  let segs = keep.map((s) => ({ start: Math.max(0, s.start - pad) + offset, end: Math.min(n / sr, s.end + pad) + offset }));

  // remove muletas reconhecidas nas legendas (se já foram geradas)
  for (const w of (words ?? []).filter(isFiller)) segs = subtract(segs, { start: w.start - 0.03, end: w.end + 0.03 });

  return merge(segs).filter((s) => s.end - s.start >= 0.12);
}

function subtract(segs: Segment[], cut: Segment): Segment[] {
  const out: Segment[] = [];
  for (const s of segs) {
    if (cut.end <= s.start || cut.start >= s.end) out.push(s);
    else {
      if (cut.start > s.start) out.push({ start: s.start, end: cut.start });
      if (cut.end < s.end) out.push({ start: cut.end, end: s.end });
    }
  }
  return out;
}

function merge(segs: Segment[]): Segment[] {
  const sorted = [...segs].sort((a, b) => a.start - b.start);
  const out: Segment[] = [];
  for (const s of sorted) {
    const last = out[out.length - 1];
    if (last && s.start <= last.end + 0.01) last.end = Math.max(last.end, s.end);
    else out.push({ ...s });
  }
  return out;
}

export const keptDuration = (segs: Segment[]) => segs.reduce((n, s) => n + (s.end - s.start), 0);

/** Instante no arquivo final para um instante do original (null se foi cortado). */
export function mapToOutput(segs: Segment[], t: number): number | null {
  let acc = 0;
  for (const s of segs) {
    if (t >= s.start && t < s.end) return acc + (t - s.start);
    acc += s.end - s.start;
  }
  return null;
}

/** Junta os trechos mantidos do áudio (tempo do original), com fade de 8 ms nas emendas contra estalos. */
export function spliceAudio(channels: Signal, sr: number, offset: number, segs: Segment[]): Signal {
  const ranges = segs.map((s) => [
    Math.max(0, Math.round((s.start - offset) * sr)),
    Math.min(channels[0].length, Math.round((s.end - offset) * sr)),
  ]);
  const len = ranges.reduce((n, [a, b]) => n + Math.max(0, b - a), 0);
  const fade = Math.round(sr * 0.008);
  return channels.map((ch) => {
    const out = new Float32Array(len);
    let o = 0;
    for (const [a, b] of ranges) {
      const piece = ch.subarray(a, b);
      out.set(piece, o);
      const m = Math.min(fade, piece.length >> 1);
      for (let i = 0; i < m; i++) {
        const g = i / m;
        out[o + i] *= g;
        out[o + piece.length - 1 - i] *= g;
      }
      o += piece.length;
    }
    return out;
  });
}
