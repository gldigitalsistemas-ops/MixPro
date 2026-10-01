/**
 * Ajuste fino do tempo das legendas pelo som.
 *
 * O Whisper acerta o texto, mas o tempo de cada palavra erra em média 250–550 ms (até ~1,8 s no
 * canto), para mais ou para menos. Aqui o tempo é realinhado com o áudio de verdade:
 *  1. do áudio sai, a cada 10 ms, "tem voz?" (energia) e "começou uma sílaba?" (subida de energia);
 *  2. das palavras sai o mesmo, como o Whisper imagina;
 *  3. um alinhamento DTW (com faixa de ±1,2 s e custo para esticar/encolher o tempo) encontra o
 *     melhor encaixe entre os dois, mantendo a ordem das palavras;
 *  4. cada palavra é levada pelo encaixe, e o início é colado no começo da sílaba mais próxima.
 * Palavras que o Whisper põe no silêncio vão para a voz; começos de frase encostam no som.
 */
import type { Signal } from "@/lib/dsp/types";
import type { Word } from "./model";

const HOP = 0.01;
/** Quanto o encaixe pode mover o tempo (s). */
const BAND_S = 1.2;
/** Custo extra para esticar ou encolher o tempo (prefere manter o ritmo do Whisper). */
const WARP_PENALTY = 0.35;

/** Energia em dB a cada 10 ms (mono). */
export function envelopeDb(channels: Signal, sr: number): Float32Array {
  const hop = Math.max(1, Math.round(sr * HOP));
  const n = Math.floor(channels[0].length / hop);
  const db = new Float32Array(n);
  for (let f = 0; f < n; f++) {
    let s = 0;
    for (const ch of channels) for (let i = f * hop; i < (f + 1) * hop; i++) s += ch[i] * ch[i];
    db[f] = 10 * Math.log10(s / (hop * channels.length) + 1e-12);
  }
  return db;
}

function percentile(v: Float32Array, p: number) {
  const s = Float32Array.from(v).sort();
  return s[Math.min(s.length - 1, Math.floor(p * (s.length - 1)))];
}

/** Voz (0–1) e começo de sílaba (0–1) a cada 10 ms. */
function observed(db: Float32Array) {
  const floor = percentile(db, 0.1);
  const loud = percentile(db, 0.95);
  const lo = Math.max(floor + 6, loud - 36);
  const hi = Math.max(lo + 6, Math.min(loud - 6, lo + 14));
  const voice = new Float32Array(db.length);
  const onset = new Float32Array(db.length);
  const range = loud - floor;
  for (let f = 0; f < db.length; f++) {
    voice[f] = Math.min(1, Math.max(0, (db[f] - lo) / (hi - lo)));
    const before = Math.max(db[Math.max(0, f - 3)], db[Math.max(0, f - 4)], db[Math.max(0, f - 5)]);
    onset[f] = voice[f] > 0.2 ? Math.min(1, Math.max(0, (db[f] - before) / 9)) : 0;
  }
  return { voice, onset, range };
}

/** O que as palavras do Whisper dizem: voz durante a palavra e começo de sílaba no início dela. */
function expected(words: Word[], frames: number) {
  const voice = new Float32Array(frames);
  const onset = new Float32Array(frames);
  for (const w of words) {
    const a = Math.max(0, Math.round(w.start / HOP));
    const b = Math.min(frames, Math.max(a + 1, Math.round(w.end / HOP)));
    for (let f = a; f < b; f++) voice[f] = 1;
    if (a < frames) onset[a] = 1;
    if (a + 1 < frames) onset[a + 1] = Math.max(onset[a + 1], 0.5);
  }
  return { voice, onset };
}

/**
 * DTW com faixa: devolve, para cada quadro do tempo do Whisper, o quadro correspondente no áudio.
 * Memória: quadros × (2·faixa+1) — 5 min de vídeo ≈ 30 mil × 241 ≈ 36 MB, só durante o cálculo.
 */
function warp(E: { voice: Float32Array; onset: Float32Array }, O: { voice: Float32Array; onset: Float32Array }): Float32Array {
  const n = E.voice.length;
  const band = Math.round(BAND_S / HOP);
  const W = 2 * band + 1;
  const INF = 1e9;
  const cost = new Float32Array(n * W).fill(INF);
  const from = new Uint8Array(n * W); // 0 diagonal, 1 de (i-1, j), 2 de (i, j-1)
  const at = (i: number, j: number) => i * W + (j - i + band);
  const local = (i: number, j: number) => Math.abs(E.voice[i] - O.voice[j]) + 0.6 * Math.abs(E.onset[i] - O.onset[j]);

  for (let i = 0; i < n; i++) {
    const jLo = Math.max(0, i - band);
    const jHi = Math.min(n - 1, i + band);
    for (let j = jLo; j <= jHi; j++) {
      const c = local(i, j);
      if (i === 0 && j === 0) {
        cost[at(0, 0)] = c;
        continue;
      }
      let best = INF;
      let dir = 0;
      if (i > 0 && j > 0 && Math.abs(j - 1 - (i - 1)) <= band) {
        const v = cost[at(i - 1, j - 1)];
        if (v < best) [best, dir] = [v, 0];
      }
      if (i > 0 && Math.abs(j - (i - 1)) <= band) {
        const v = cost[at(i - 1, j)] + WARP_PENALTY;
        if (v < best) [best, dir] = [v, 1];
      }
      if (j > 0 && Math.abs(j - 1 - i) <= band) {
        const v = cost[at(i, j - 1)] + WARP_PENALTY;
        if (v < best) [best, dir] = [v, 2];
      }
      if (best >= INF) continue;
      cost[at(i, j)] = best + c;
      from[at(i, j)] = dir;
    }
  }

  // caminho de volta a partir do fim
  const map = new Float32Array(n);
  const count = new Uint16Array(n);
  let i = n - 1;
  let j = n - 1;
  while (i >= 0 && j >= 0) {
    map[i] += j;
    count[i]++;
    if (i === 0 && j === 0) break;
    const d = from[at(i, j)];
    if (d === 0) {
      i--;
      j--;
    } else if (d === 1) i--;
    else j--;
  }
  for (let k = 0; k < n; k++) map[k] = count[k] ? map[k] / count[k] : k;
  return map;
}

/** Acima disso (fração do tempo com som), o áudio é contínuo demais para o encaixe completo. */
const DENSE = 0.85;
/** Faixa entre o trecho mais baixo e o mais alto (dB): canto com instrumento e música ficam abaixo. */
const MIN_RANGE_DB = 22;

/** Palavra que começa no silêncio vai para o começo da voz seguinte (até 1 s depois). */
function fixSilentStarts(words: Word[], voice: Float32Array): Word[] {
  const out = words.map((w) => ({ ...w }));
  for (let k = 0; k < out.length; k++) {
    const a = Math.round(out[k].start / HOP);
    let silent = true;
    for (let f = a; f < Math.min(voice.length, a + 15); f++) if (voice[f] > 0.2) silent = false;
    if (!silent) continue;
    for (let f = a; f < Math.min(voice.length, a + 100); f++) {
      if (voice[f] > 0.5) {
        const s = f * HOP;
        if (s < out[k].end) out[k].start = s;
        else out[k] = { ...out[k], start: s, end: s + (out[k].end - out[k].start) };
        break;
      }
    }
  }
  for (let k = 1; k < out.length; k++) if (out[k - 1].end > out[k].start) out[k - 1].end = Math.max(out[k - 1].start + 0.06, out[k].start);
  return out;
}

/** Começo de sílaba mais forte perto de `f` (±60 ms), senão o próprio `f`. */
function snapToOnset(f: number, onset: Float32Array): number {
  let best = f;
  let bestV = 0.25;
  for (let k = Math.max(0, f - 6); k <= Math.min(onset.length - 1, f + 6); k++) {
    const v = onset[k] - Math.abs(k - f) * 0.02;
    if (v > bestV) [best, bestV] = [k, v];
  }
  return best;
}

/**
 * Realinha as palavras com o áudio. Tempos de entrada e saída em segundos desde a primeira amostra.
 * Se algo der errado, devolve as palavras como vieram.
 */
export function alignWords(words: Word[], channels: Signal, sr: number): Word[] {
  if (words.length < 2 || !channels.length || !channels[0].length) return words;
  try {
    const db = envelopeDb(channels, sr);
    const n = db.length;
    if (n < 20) return words;
    const O = observed(db);
    // som quase contínuo (canto com instrumento, música): sem pausas o encaixe não tem onde se
    // apoiar e pode piorar; aí só tira do silêncio as palavras que caíram nele
    let voiced = 0;
    for (let f = 0; f < n; f++) if (O.voice[f] > 0.5) voiced++;
    if (O.range < MIN_RANGE_DB || voiced / n > DENSE) return fixSilentStarts(words, O.voice);
    const E = expected(words, n);
    const map = warp(E, O);
    const toAudio = (t: number) => {
      const f = Math.min(n - 1, Math.max(0, t / HOP));
      const k = Math.floor(f);
      const v = k + 1 < n ? map[k] + (map[k + 1] - map[k]) * (f - k) : map[k];
      return v * HOP;
    };
    const out = words.map((w) => {
      const s = snapToOnset(Math.round(toAudio(w.start) / HOP), O.onset) * HOP;
      return { ...w, start: s, end: Math.max(s + 0.08, toAudio(w.end)) };
    });
    // ordem e sem sobreposição
    for (let k = 1; k < out.length; k++) {
      if (out[k].start < out[k - 1].start + 0.04) out[k].start = out[k - 1].start + 0.04;
      if (out[k - 1].end > out[k].start) out[k - 1].end = out[k].start;
      if (out[k].end < out[k].start + 0.06) out[k].end = out[k].start + 0.06;
    }
    return out;
  } catch {
    return words;
  }
}
