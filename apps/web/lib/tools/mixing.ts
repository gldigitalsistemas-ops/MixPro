/**
 * Mixagens das ferramentas (puras, sem rede): Voz + Playback, Masterização por referência e Modo álbum.
 * Usam os mesmos módulos de DSP do Estúdio (EQ, compressor, reverb, limiter e loudness BS.1770).
 */
import { compressor } from "@/lib/dsp/dynamics";
import { finalizeForSocial } from "@/lib/dsp/chain";
import { applySections, butterworth, eqPeak, eqShelf, highpass } from "@/lib/dsp/filters";
import { integratedLoudness, samplePeak } from "@/lib/dsp/loudness";
import { resample } from "@/lib/dsp/resample";
import { reverb } from "@/lib/dsp/space";
import type { Signal } from "@/lib/dsp/types";
import { OCTAVE_CENTERS, octaveSpectrumDb } from "./analysis";

const db = (v: number) => 20 * Math.log10(Math.max(v, 1e-9));
const gainOf = (d: number) => 10 ** (d / 20);

/** Mesma taxa e no máximo 2 canais. */
export function toRate(x: Signal, from: number, to: number): Signal {
  return from === to ? x : (x.map((c) => resample(c, from, to)) as Signal);
}

function monoOf(x: Signal): Float32Array<ArrayBuffer> {
  const n = x[0].length;
  const m = new Float32Array(n);
  for (const c of x) for (let i = 0; i < n; i++) m[i] += c[i] / x.length;
  return m;
}

/** Envelope de ataques a 100 Hz (para alinhar gravações). */
function onsetEnvelope(x: Signal, sr: number): Float32Array {
  const m = monoOf(x);
  applySections(m, [...butterworth("hp", 2, 150, sr), ...butterworth("lp", 2, 4000, sr)]);
  const hop = Math.round(sr / 100);
  const n = Math.floor(m.length / hop);
  const env = new Float32Array(n);
  let prev = 0;
  for (let f = 0; f < n; f++) {
    let e = 0;
    for (let i = f * hop; i < (f + 1) * hop; i++) e += m[i] * m[i];
    const v = Math.log1p(1000 * Math.sqrt(e / hop));
    env[f] = Math.max(0, v - prev);
    prev = v;
  }
  return env;
}

/**
 * Atraso da voz em relação ao playback (s; positivo = a voz entra depois), por correlação dos ataques
 * (funciona quando a gravação da voz captou o playback ao fundo). Sem correlação clara, devolve 0.
 */
export function alignOffset(voice: Signal, playback: Signal, sr: number, maxS = 3): { offsetS: number; confidence: number } {
  const a = onsetEnvelope(voice, sr);
  const b = onsetEnvelope(playback, sr);
  const maxLag = Math.min(maxS * 100, Math.floor(Math.min(a.length, b.length) / 2));
  let best = -Infinity;
  let bestLag = 0;
  let sum = 0;
  let count = 0;
  for (let lag = -maxLag; lag <= maxLag; lag++) {
    let s = 0;
    for (let i = Math.max(0, lag); i < a.length && i - lag < b.length; i++) s += a[i] * b[i - lag];
    sum += s;
    count++;
    if (s > best) {
      best = s;
      bestLag = lag;
    }
  }
  const mean = sum / Math.max(1, count);
  const confidence = best > 0 ? Math.max(0, Math.min(1, (best - mean) / best)) : 0;
  return confidence >= 0.35 ? { offsetS: bestLag / 100, confidence } : { offsetS: 0, confidence };
}

export type VoicePlaybackOptions = {
  /** s; positivo = a voz entra depois do começo do playback. */
  offsetS: number;
  /** Equilíbrio voz × playback (dB; 0 = padrão de estúdio, voz ~1,5 dB à frente). */
  voiceLevelDb: number;
  /** Reverb na voz, 0–100. */
  reverb: number;
  targetLufs: number;
  ceilingDb: number;
};

/** Ganho variável no playback quando a voz entra (até `depthDb`), com ataque e liberação suaves. */
function duck(playback: Signal, voice: Float32Array, sr: number, depthDb: number) {
  const hop = Math.round(sr * 0.01);
  const frames = Math.ceil(voice.length / hop);
  const env = new Float32Array(frames);
  let peak = 0;
  for (let f = 0; f < frames; f++) {
    let e = 0;
    const end = Math.min(voice.length, (f + 1) * hop);
    for (let i = f * hop; i < end; i++) e += voice[i] * voice[i];
    env[f] = Math.sqrt(e / Math.max(1, end - f * hop));
    peak = Math.max(peak, env[f]);
  }
  if (peak <= 0) return;
  const gate = peak * 0.12;
  const att = Math.exp(-1 / 2); // ~20 ms
  const rel = Math.exp(-1 / 30); // ~300 ms
  let g = 0;
  const target = new Float32Array(frames);
  for (let f = 0; f < frames; f++) {
    const want = env[f] > gate ? 1 : 0;
    g = want > g ? want + (g - want) * att : want + (g - want) * rel;
    target[f] = g;
  }
  const depth = 1 - gainOf(-Math.abs(depthDb));
  for (const ch of playback) {
    for (let i = 0; i < ch.length && i < voice.length; i++) {
      const f = i / hop;
      const f0 = Math.floor(f);
      const t = target[f0] + ((target[Math.min(frames - 1, f0 + 1)] ?? 0) - target[f0]) * (f - f0);
      ch[i] *= 1 - depth * t;
    }
  }
}

/** Voz tratada por cima do playback, com espaço na mix, e a soma masterizada no destino. */
export function mixVoicePlayback(voiceIn: Signal, playbackIn: Signal, sr: number, o: VoicePlaybackOptions): { out: Signal; report: Record<string, number> } {
  // voz: mono, cadeia de estúdio (graves, embolado, presença, sibilância, compressão, reverb)
  let voice: Signal = [monoOf(voiceIn)];
  voice = highpass(voice, sr, { frequency_hz: 90, slope_db_oct: "12" });
  voice = eqPeak(voice, sr, { frequency_hz: 300, gain_db: -2, q: 1 });
  voice = eqPeak(voice, sr, { frequency_hz: 3200, gain_db: 2.5, q: 0.9 });
  voice = eqPeak(voice, sr, { frequency_hz: 7500, gain_db: -2, q: 2 });
  voice = compressor(voice, sr, { threshold_db: -22, ratio: 3.5, attack_ms: 5, release_ms: 80, knee_db: 6, makeup_db: 0 });
  const dry = voice[0].slice();
  voice = reverb(voice, sr, { room_size: 45, damping: 55, width: 100, predelay_ms: 25, mix: Math.max(0, Math.min(100, o.reverb)) * 0.6 });
  // voz no centro (estéreo)
  const v2: Signal = voice.length === 2 ? voice : [voice[0], voice[0].slice()];

  // playback: estéreo, espaço para a voz nos médios-agudos
  let pb: Signal = playbackIn.length >= 2 ? [playbackIn[0].slice(), playbackIn[1].slice()] : [playbackIn[0].slice(), playbackIn[0].slice()];
  pb = eqPeak(pb, sr, { frequency_hz: 2500, gain_db: -2, q: 1 });

  // equilíbrio pelas loudness reais
  const lv = integratedLoudness(v2, sr);
  const lp = integratedLoudness(pb, sr);
  const voiceGain = Number.isFinite(lv) && Number.isFinite(lp) ? gainOf(lp + 1.5 + o.voiceLevelDb - lv) : 1;

  // alinhamento
  const shift = Math.round(o.offsetS * sr);
  const n = Math.max(pb[0].length, v2[0].length + shift);
  const aligned = new Float32Array(n);
  for (let i = 0; i < dry.length; i++) {
    const j = i + shift;
    if (j >= 0 && j < n) aligned[j] = dry[i];
  }
  const out: Signal = [new Float32Array(n), new Float32Array(n)];
  for (let c = 0; c < 2; c++) out[c].set(pb[c].subarray(0, Math.min(n, pb[c].length)));
  duck(out, aligned, sr, 2.5);
  for (let c = 0; c < 2; c++) {
    const src = v2[c];
    for (let i = 0; i < src.length; i++) {
      const j = i + shift;
      if (j >= 0 && j < n) out[c][j] += src[i] * voiceGain;
    }
  }
  // cola da mix e master no destino
  let mix = compressor(out, sr, { threshold_db: -14, ratio: 1.8, attack_ms: 20, release_ms: 150, knee_db: 6, makeup_db: 0 });
  mix = finalizeForSocial(mix, sr, o.targetLufs, o.ceilingDb);
  return { out: mix, report: { lufs: integratedLoudness(mix, sr), voz_lufs: lv, playback_lufs: lp, deslocamento_s: o.offsetS } };
}

/** Diferença de timbre (dB por oitava), normalizada pela média das bandas centrais. */
export function tonalDiff(from: number[], to: number[], maxDb: number): number[] {
  const mid = (s: number[]) => (s[3] + s[4] + s[5] + s[6] + s[7]) / 5; // 250 Hz a 4 kHz
  const a = from.map((v) => v - mid(from));
  const b = to.map((v) => v - mid(to));
  const raw = b.map((v, i) => Math.max(-maxDb, Math.min(maxDb, v - a[i])));
  // suaviza entre oitavas vizinhas (evita "dentes" na curva)
  return raw.map((v, i) => 0.25 * (raw[i - 1] ?? v) + 0.5 * v + 0.25 * (raw[i + 1] ?? v));
}

/** Aplica uma curva por oitava: prateleiras nos extremos e sinos no meio. */
export function applyOctaveEq(x: Signal, sr: number, gains: number[]): Signal {
  let y = x;
  gains.forEach((g, i) => {
    if (Math.abs(g) < 0.2) return;
    const f = OCTAVE_CENTERS[i];
    if (f >= sr / 2 - 100) return;
    if (i === 0) y = eqShelf(y, sr, { frequency_hz: 45, gain_db: g, q: 0.7, position: "low" });
    else if (i === gains.length - 1) y = eqShelf(y, sr, { frequency_hz: 11000, gain_db: g, q: 0.7, position: "high" });
    else y = eqPeak(y, sr, { frequency_hz: f, gain_db: g, q: 1.0 });
  });
  return y;
}

const plrOf = (x: Signal, sr: number) => db(samplePeak(x)) - integratedLoudness(x, sr);

export type ReferenceOptions = { amount: number; ceilingDb: number };

/**
 * Masterização por referência: timbre (EQ por oitava, até ±6 dB × intensidade), densidade (compressão
 * quando a referência é bem mais "cheia") e loudness da referência (entre -20 e -8 LUFS), com teto de pico.
 */
export function referenceMaster(input: Signal, ref: Signal, sr: number, o: ReferenceOptions) {
  const amount = Math.max(0, Math.min(1, o.amount));
  const specIn = octaveSpectrumDb(input, sr);
  const specRef = octaveSpectrumDb(ref, sr);
  const eq = tonalDiff(specIn, specRef, 6).map((g) => g * amount);
  // os filtros do motor alteram o sinal no lugar: trabalha numa cópia (a entrada fica intacta)
  let y = applyOctaveEq(input.map((c) => c.slice()) as Signal, sr, eq);
  const refPlr = plrOf(ref, sr);
  const inPlr = plrOf(y, sr);
  let compressed = false;
  if (Number.isFinite(refPlr) && Number.isFinite(inPlr) && inPlr - refPlr > 3) {
    const lufs = integratedLoudness(y, sr);
    y = compressor(y, sr, { threshold_db: lufs + 4, ratio: 1 + Math.min(2.5, (inPlr - refPlr) / 4) * amount, attack_ms: 15, release_ms: 120, knee_db: 6, makeup_db: 0 });
    compressed = true;
  }
  const refLufs = integratedLoudness(ref, sr);
  const target = Number.isFinite(refLufs) ? Math.max(-20, Math.min(-8, refLufs)) : -14;
  y = finalizeForSocial(y, sr, target, o.ceilingDb);
  return {
    out: y,
    report: {
      referencia_lufs: refLufs,
      alvo_lufs: target,
      resultado_lufs: integratedLoudness(y, sr),
      compressao: compressed ? 1 : 0,
      eq_db: eq.map((g) => Math.round(g * 10) / 10),
    },
  };
}

export type AlbumTrack = { channels: Signal; sampleRate: number };

/**
 * Modo álbum: aproxima o timbre de cada faixa da média do álbum (até ±4 dB × intensidade) e leva
 * todas ao mesmo volume (destino) com o mesmo teto. Resultado: faixas consistentes entre si.
 */
export function albumMaster(tracks: AlbumTrack[], o: { amount: number; targetLufs: number; ceilingDb: number }) {
  const specs = tracks.map((t) => octaveSpectrumDb(t.channels, t.sampleRate));
  const mid = (s: number[]) => (s[3] + s[4] + s[5] + s[6] + s[7]) / 5;
  const norm = specs.map((s) => s.map((v) => v - mid(s)));
  const avg = OCTAVE_CENTERS.map((_, i) => norm.reduce((a, s) => a + s[i], 0) / norm.length);
  return tracks.map((t, k) => {
    const eq = tonalDiff(specs[k], avg, 4).map((g) => g * Math.max(0, Math.min(1, o.amount)));
    const y = finalizeForSocial(applyOctaveEq(t.channels.map((c) => c.slice()) as Signal, t.sampleRate, eq), t.sampleRate, o.targetLufs, o.ceilingDb);
    return { out: y, lufs: integratedLoudness(y, t.sampleRate), eq };
  });
}
