/**
 * Modo Cover: o playback (música sem o instrumento que a pessoa toca), encaixado no tempo do vídeo, somado à
 * performance tratada e masterizado para o Instagram (−14 LUFS, teto −2 dBFS).
 */
import { finalizeForSocial } from "@/lib/dsp/chain";
import { integratedLoudness } from "@/lib/dsp/loudness";
import { resample } from "@/lib/dsp/resample";
import type { Signal } from "@/lib/dsp/types";
import type { Instrument } from "@/lib/mix";

export type CoverPart = { id: string; label: string; emoji: string; stems: number[]; chain: Instrument | "voz" };

/** O que dá para tocar por cima, conforme as pistas do VS (básico: 4; Premium: 7). */
export function coverParts(ids: string[] | undefined): CoverPart[] {
  const at = (...names: string[]) => names.map((n) => (ids ?? ["drums", "bass", "other", "vocals"]).indexOf(n)).filter((i) => i >= 0);
  const list: CoverPart[] = [
    { id: "bateria", label: "Bateria", emoji: "🥁", stems: at("drums", "bateria"), chain: "drums" },
    { id: "baixo", label: "Baixo", emoji: "🎸", stems: at("bass", "baixo"), chain: "bass" },
    { id: "voz", label: "Voz", emoji: "🎤", stems: at("vocals", "voz"), chain: "voz" },
    { id: "guitarra", label: "Guitarra", emoji: "🎸", stems: at("guitarra"), chain: "guitar" },
    { id: "violao", label: "Violão", emoji: "🪕", stems: at("violao"), chain: "acoustic" },
    { id: "teclado", label: "Teclado", emoji: "🎹", stems: at("teclado"), chain: "piano" },
    // VS básico: guitarra, violão e teclado ficam juntos em "instrumentos"
    { id: "instrumentos", label: "Instrumentos (guitarra, violão, teclado)", emoji: "🎹", stems: at("other"), chain: "guitar" },
  ];
  return list.filter((p) => p.stems.length > 0);
}

const toFloat = (x: Int16Array) => Float32Array.from(x, (v) => v / 32768);

/** Soma das pistas do VS (16 bits) — todas, menos as de `exclude` — em ponto flutuante estéreo. */
export function sumStems(stems: Int16Array[][], exclude: number[] = [], only?: number[]): Signal {
  const n = stems[0]?.[0]?.length ?? 0;
  const out: Signal = [new Float32Array(n), new Float32Array(n)];
  stems.forEach((st, k) => {
    if (exclude.includes(k) || (only && !only.includes(k))) return;
    for (let c = 0; c < 2; c++) {
      const src = st[c] ?? st[0];
      for (let i = 0; i < n; i++) out[c][i] += src[i] / 32768;
    }
  });
  return out;
}

export { toFloat };

/** Mono das pistas escolhidas (`only`) ou de todas menos `exclude`: para a sincronia (pouca memória). */
export function monoStems(stems: Int16Array[][], o: { only?: number[]; exclude?: number[] } = {}): Float32Array<ArrayBuffer> {
  const n = stems[0]?.[0]?.length ?? 0;
  const out = new Float32Array(n);
  stems.forEach((st, k) => {
    if (o.exclude?.includes(k) || (o.only && !o.only.includes(k))) return;
    for (const ch of st.slice(0, 2)) for (let i = 0; i < n; i++) out[i] += ch[i] / 65536;
  });
  return out;
}

/**
 * Playback (todas as pistas menos `exclude`) já na linha do tempo do vídeo: um canal por vez (no celular a
 * memória é curta), na taxa do vídeo, começando no instante `offsetS`.
 */
export function playbackOnTimeline(stems: Int16Array[][], exclude: number[], fromSr: number, toSr: number, offsetS: number, n: number): Signal {
  const len = stems[0]?.[0]?.length ?? 0;
  const out: Float32Array[] = [];
  for (let c = 0; c < 2; c++) {
    const ch = new Float32Array(len);
    stems.forEach((st, k) => {
      if (exclude.includes(k)) return;
      const src = st[c] ?? st[0];
      for (let i = 0; i < len; i++) ch[i] += src[i] / 32768;
    });
    out.push(placeOnTimeline([ch], fromSr, toSr, offsetS, n)[0]);
  }
  return out as Signal;
}

/**
 * Põe `x` (na taxa `fromSr`) na linha do tempo do vídeo: a amostra 0 de `x` cai no instante `offsetS` do vídeo.
 * Saída com `n` amostras na taxa `toSr` (o resto é silêncio).
 */
export function placeOnTimeline(x: Signal, fromSr: number, toSr: number, offsetS: number, n: number): Signal {
  const src = fromSr === toSr ? x : x.map((c) => resample(c as Float32Array<ArrayBuffer>, fromSr, toSr));
  const shift = Math.round(offsetS * toSr);
  return src.map((c) => {
    const o = new Float32Array(n);
    const from = Math.max(0, -shift);
    const to = Math.min(c.length, n - shift);
    for (let i = from; i < to; i++) o[i + shift] = c[i];
    return o;
  }) as Signal;
}

const gain = (db: number) => 10 ** (db / 20);

/**
 * Performance (já tratada) + playback no tempo do vídeo. `balanceDb` > 0 = música mais alta. O equilíbrio parte
 * das loudness reais (a performance ~1 dB à frente, como num vídeo de cover), e a soma é masterizada (−14 LUFS).
 */
export function mixCover(performance: Signal, playback: Signal, sr: number, balanceDb = 0): { out: Signal; lufs: number; perfGain: number; musicGain: number } {
  const n = Math.max(performance[0].length, playback[0].length);
  const perf: Signal = performance.length >= 2 ? performance : [performance[0], performance[0]];
  const lp = integratedLoudness(perf, sr);
  const lm = integratedLoudness(playback, sr);
  // ganho de cada lado (relativo): música = performance − 1 dB + equilíbrio
  const musicGain = Number.isFinite(lp) && Number.isFinite(lm) ? gain(lp - 1 + balanceDb - lm) : gain(balanceDb);
  const out: Signal = [new Float32Array(n), new Float32Array(n)];
  for (let c = 0; c < 2; c++) {
    const a = perf[c];
    const b = playback[c] ?? playback[0];
    for (let i = 0; i < n; i++) out[c][i] = (a[i] ?? 0) + (b[i] ?? 0) * musicGain;
  }
  // teto em −2 dBFS: o AAC do vídeo (e a recompressão do Instagram) passam do teto em 1–3 dB; −1 ainda distorce
  const final = finalizeForSocial(out, sr, -14, -2);
  return { out: final, lufs: integratedLoudness(final, sr), perfGain: 1, musicGain };
}
