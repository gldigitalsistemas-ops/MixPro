/** Loudness integrada ITU-R BS.1770-4 (K-weighting + gates absoluto -70 LUFS e relativo -10 LU). */
import { shelfBiquad, type Biquad } from "./filters";
import type { Signal } from "./types";

function kWeighting(sr: number): Biquad[] {
  const w0 = (2 * Math.PI * 38) / sr;
  const cw = Math.cos(w0);
  const alpha = Math.sin(w0) / (2 * 0.5);
  const a0 = 1 + alpha;
  const hp: Biquad = [(1 + cw) / 2 / a0, -(1 + cw) / a0, (1 + cw) / 2 / a0, (-2 * cw) / a0, (1 - alpha) / a0];
  return [shelfBiquad(sr, 1500, 4, Math.SQRT1_2, "high"), hp];
}

/** Retorna -Infinity para áudio curto demais (< 400 ms) ou silencioso. */
export function integratedLoudness(audio: Signal, sr: number): number {
  const n = audio[0]?.length ?? 0;
  const block = Math.round(0.4 * sr);
  const hop = Math.round(0.1 * sr);
  if (n < block) return -Infinity;

  // energia K-ponderada por segmento de 100 ms (soma dos canais, peso 1 para L/R)
  const segCount = Math.floor(n / hop);
  const seg = new Float64Array(segCount);
  const sections = kWeighting(sr);
  const chunk = new Float32Array(Math.min(n, sr * 10));
  for (const ch of audio) {
    // filtra em blocos para não duplicar o canal inteiro na memória
    const state = sections.map(() => [0, 0]);
    for (let start = 0; start < segCount * hop; start += chunk.length) {
      const len = Math.min(chunk.length, segCount * hop - start);
      const buf = chunk.subarray(0, len);
      buf.set(ch.subarray(start, start + len));
      sections.forEach(([b0, b1, b2, a1, a2], s) => {
        let [z1, z2] = state[s];
        for (let i = 0; i < len; i++) {
          const v = buf[i];
          const y = b0 * v + z1;
          z1 = b1 * v - a1 * y + z2;
          z2 = b2 * v - a2 * y;
          buf[i] = y;
        }
        state[s] = [z1, z2];
      });
      for (let i = 0; i < len; i++) seg[Math.floor((start + i) / hop)] += buf[i] * buf[i];
    }
  }

  const blocks: number[] = [];
  for (let s = 0; s + 4 <= segCount; s++) blocks.push((seg[s] + seg[s + 1] + seg[s + 2] + seg[s + 3]) / (4 * hop));
  const lufs = (z: number) => -0.691 + 10 * Math.log10(z);

  const abs = blocks.filter((z) => lufs(z) > -70);
  if (!abs.length) return -Infinity;
  const relGate = lufs(abs.reduce((a, b) => a + b, 0) / abs.length) - 10;
  const rel = abs.filter((z) => lufs(z) > relGate);
  if (!rel.length) return -Infinity;
  return lufs(rel.reduce((a, b) => a + b, 0) / rel.length);
}

export function samplePeak(audio: Signal): number {
  let p = 0;
  for (const ch of audio) for (let i = 0; i < ch.length; i++) {
    const v = Math.abs(ch[i]);
    if (v > p) p = v;
  }
  return p;
}

/** Picos (0–255) para desenhar a forma de onda. */
export function waveformPeaks(audio: Signal, points = 1200): number[] {
  const n = audio[0]?.length ?? 0;
  if (!n) return [];
  const out = new Array<number>(points).fill(0);
  const step = n / points;
  let max = 0;
  for (let p = 0; p < points; p++) {
    const from = Math.floor(p * step);
    const to = Math.max(from + 1, Math.floor((p + 1) * step));
    let v = 0;
    for (const ch of audio) for (let i = from; i < to && i < n; i++) {
      const a = Math.abs(ch[i]);
      if (a > v) v = a;
    }
    out[p] = v;
    if (v > max) max = v;
  }
  const scale = max > 0 ? 255 / max : 0;
  return out.map((v) => Math.round(v * scale));
}
