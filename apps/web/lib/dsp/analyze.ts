/**
 * Análise automática ao importar: descobre o que tem no arquivo (fala, canto, bateria,
 * instrumento, música pronta), quanto ruído de fundo existe e se a gravação estourou.
 * Com isso o estúdio já escolhe o preset, a intensidade e a remoção de ruído.
 *
 * Medidas (todas explicáveis):
 *  - ritmo de sílabas: a fala sobe e desce de volume 2,5–8 vezes por segundo;
 *  - profundidade: música pronta (masterizada) quase não varia de volume;
 *  - faixa da voz (300–3400 Hz), graves e brilho: onde está a energia;
 *  - fundo: nível das partes mais baixas em relação às mais altas.
 */
import { applySections, butterworth } from "./filters";
import type { Signal } from "./types";

export type ContentKind = "speech" | "singing" | "drums" | "instrument" | "music";
export type InstrumentType = "violao" | "guitarra" | "baixo" | "teclado";
/** "mic": celular ou microfone (tem sala e ruído); "plugado": cabo, interface ou pedaleira. */
export type RecordingSource = "mic" | "plugado";
export type InstrumentGuess = { type: InstrumentType; source: RecordingSource };

export type AudioAnalysis = {
  kind: ContentKind;
  /** 0–1: quão seguro está o palpite. */
  confidence: number;
  /** Diferença entre as partes altas e o fundo (dB). */
  snrDb: number;
  noise: "clean" | "some" | "noisy";
  /** Fração de amostras no limite (gravação estourada). */
  clipping: number;
  /** Energia abaixo de 60 Hz em relação ao total (vento, ar-condicionado, batida na mesa). */
  rumble: number;
  features: { syllabic: number; depth: number; voiceBand: number; low: number; air: number; harmonicity: number };
  /** Palpite de instrumento e de como foi gravado (só quando o tipo é instrumento). */
  instrument: InstrumentGuess | null;
};

/**
 * Palpite simples (o usuário confirma no cartão do ajuste automático):
 *  - baixo: a maior parte da energia abaixo de 250 Hz;
 *  - violão: cordas com bastante brilho acima de 6 kHz; guitarra (captador ou caixa) quase não tem;
 *  - plugado: fundo muito silencioso entre as notas (sem sala, sem ruído do ambiente).
 * Teclado não dá para separar com segurança: fica para o usuário escolher.
 */
export function guessInstrument(f: { bassShare: number; air: number; snrDb: number }): InstrumentGuess {
  const type: InstrumentType = f.bassShare > 0.55 ? "baixo" : f.air > 0.008 ? "violao" : "guitarra";
  return { type, source: f.snrDb >= 45 ? "plugado" : "mic" };
}

const FRAME_S = 0.02;
const FS = 1 / FRAME_S;

function mono(audio: Signal): Float32Array {
  const n = audio[0].length;
  const m = new Float32Array(n);
  for (const ch of audio) for (let i = 0; i < n; i++) m[i] += ch[i] / audio.length;
  return m;
}

function frameDb(x: Float32Array, hop: number): Float32Array {
  const frames = Math.floor(x.length / hop);
  const out = new Float32Array(frames);
  for (let f = 0; f < frames; f++) {
    let s = 0;
    for (let i = f * hop; i < (f + 1) * hop; i++) s += x[i] * x[i];
    out[f] = 10 * Math.log10(s / hop + 1e-12);
  }
  return out;
}

const pct = (v: Float32Array, p: number) => {
  const s = Float32Array.from(v).sort();
  return s.length ? s[Math.min(s.length - 1, Math.floor(p * (s.length - 1)))] : -120;
};

function energy(x: Float32Array, sections?: ReturnType<typeof butterworth>): number {
  const y = sections ? x.slice() : x;
  if (sections) applySections(y, sections);
  let s = 0;
  for (let i = 0; i < y.length; i += 2) s += y[i] * y[i];
  return s;
}

/**
 * Espectro de modulação do envelope de volume (DFT direta; o envelope tem ~50 pontos/s).
 * Devolve a fração no ritmo de sílabas (2,5–8 Hz) e a profundidade da variação.
 */
function modulation(db: Float32Array): { syllabic: number; depth: number } {
  const floor = pct(db, 0.1);
  const lin = Float32Array.from(db, (v) => 10 ** (Math.max(v, floor) / 20));
  const mean = lin.reduce((a, b) => a + b, 0) / Math.max(1, lin.length);
  if (mean <= 0) return { syllabic: 0, depth: 0 };
  for (let i = 0; i < lin.length; i++) lin[i] = lin[i] / mean - 1;
  const n = lin.length;
  const power = (lo: number, hi: number) => {
    let s = 0;
    for (let f = lo; f <= hi; f += FS / n) {
      const w = (2 * Math.PI * f) / FS;
      let re = 0;
      let im = 0;
      for (let k = 0; k < n; k++) {
        re += lin[k] * Math.cos(w * k);
        im -= lin[k] * Math.sin(w * k);
      }
      s += re * re + im * im;
    }
    return s;
  };
  const all = power(0.3, 20) || 1;
  return { syllabic: power(2.5, 8) / all, depth: Math.sqrt(lin.reduce((a, b) => a + b * b, 0) / n) };
}

/**
 * Harmonicidade (0–1): nos trechos mais altos, quanto o som se repete num período de 80–400 Hz
 * (o "tom" da voz ou de uma nota). Voz e instrumentos têm tom; caixa, prato e chimbal são ruído.
 * É o que separa bateria gravada no celular de fala (as duas têm ataques no ritmo de sílabas).
 * Calculada a ~8 kHz e só nos quadros mais altos para ser rápida.
 */
function harmonicity(x0: Float32Array, sr: number): number {
  const band = x0.slice();
  applySections(band, [...butterworth("hp", 2, 70, sr), ...butterworth("lp", 4, 1000, sr)]);
  const step = Math.max(1, Math.floor(sr / 8000));
  const fs = sr / step;
  const x = new Float32Array(Math.floor(band.length / step));
  for (let i = 0; i < x.length; i++) x[i] = band[i * step];
  const win = Math.round(fs * 0.04);
  const hop = Math.round(fs * 0.02);
  const lo = Math.round(fs / 400);
  const hi = Math.round(fs / 80);
  const starts: { s: number; e: number }[] = [];
  for (let s = 0; s + win + hi < x.length; s += hop) {
    let e = 0;
    for (let i = 0; i < win; i++) e += x[s + i] * x[s + i];
    starts.push({ s, e });
  }
  if (!starts.length) return 0;
  const loud = starts.sort((a, b) => b.e - a.e).slice(0, Math.max(1, Math.floor(starts.length * 0.4)));
  let sum = 0;
  for (const { s, e } of loud) {
    let best = 0;
    for (let lag = lo; lag <= hi; lag++) {
      let c = 0;
      let e1 = 0;
      for (let i = 0; i < win; i++) {
        c += x[s + i] * x[s + i + lag];
        e1 += x[s + i + lag] * x[s + i + lag];
      }
      best = Math.max(best, c / Math.sqrt(e * e1 + 1e-12));
    }
    sum += best;
  }
  return sum / loud.length;
}

/** Analisa até 60 s do arquivo (o trecho do meio): o suficiente para decidir, rápido no celular. */
export function analyzeAudio(audio: Signal, sr: number): AudioAnalysis {
  let x = mono(audio);
  const maxLen = sr * 60;
  if (x.length > maxLen) {
    const start = Math.floor((x.length - maxLen) / 2);
    x = x.slice(start, start + maxLen);
  }
  const hop = Math.max(1, Math.round(sr * FRAME_S));

  let peak = 0;
  let clipped = 0;
  for (let i = 0; i < x.length; i++) {
    const a = Math.abs(x[i]);
    if (a > peak) peak = a;
    if (a > 0.985) clipped++;
  }
  const clipping = peak > 0.985 ? clipped / x.length : 0;

  const total = energy(x, butterworth("hp", 1, 20, sr)) || 1e-12;
  const voice = x.slice();
  applySections(voice, [...butterworth("hp", 2, 300, sr), ...butterworth("lp", 2, 3400, sr)]);
  const voiceBand = energy(voice) / total;
  const low = energy(x, [...butterworth("hp", 2, 40, sr), ...butterworth("lp", 2, 120, sr)]) / total;
  const air = energy(x, butterworth("hp", 4, 6000, sr)) / total;
  const rumble = energy(x, butterworth("lp", 4, 60, sr)) / total;
  const bassShare = energy(x, [...butterworth("hp", 2, 30, sr), ...butterworth("lp", 4, 250, sr)]) / total;

  const db = frameDb(x, hop);
  const snrDb = Math.max(0, pct(db, 0.9) - pct(db, 0.1));
  const { syllabic, depth } = modulation(frameDb(voice, hop));
  const harm = harmonicity(x, sr);
  // som sem tom e com ataques (varia muito de volume) = percussão, mesmo com energia na faixa da voz
  const toneless = harm < 0.58;
  const percussive = harm < 0.6 && depth > 0.5;

  // pontuações simples por tipo (calibradas com gravações reais de fala, bateria no celular, música e guitarra)
  const scores: Record<ContentKind, number> = {
    // fala tem ritmo de sílabas; com notas sustentadas (pouca sílaba) não é fala
    speech:
      (syllabic - 0.3) * 4 + (voiceBand - 0.35) * 2 + (depth > 0.45 ? 0.4 : 0) + (harm - 0.62) * 2 - (toneless ? 1.5 : 0) - (syllabic < 0.25 ? 1.2 : 0),
    // canto: voz com tom, notas sustentadas e energia na faixa da voz; instrumento sozinho tem pouca faixa de voz
    singing:
      (0.3 - Math.abs(syllabic - 0.3)) * 2 +
      (voiceBand - 0.35) * 2 +
      (depth > 0.3 && depth < 0.8 ? 0.2 : 0) -
      0.1 -
      (syllabic < 0.22 && voiceBand < 0.55 ? 0.6 : 0) +
      (syllabic < 0.3 && harm > 0.75 && voiceBand > 0.55 ? 1 : 0) +
      (harm - 0.62) * 2 -
      (toneless ? 1.5 : 0),
    drums: (low - 0.25) * 3 + (0.2 - voiceBand) * 3 + air * 4 + (depth > 0.8 ? 0.3 : 0) + (percussive ? 1.5 + (0.6 - harm) * 3 : 0),
    instrument: (0.25 - syllabic) * 3 + (depth > 0.3 ? 0.3 : -0.3) - air * 5 + (harm - 0.6) * 2,
    music: (0.35 - depth) * 3 + (0.25 - syllabic) * 1.5 + low * 0.5,
  };
  const ranked = (Object.keys(scores) as ContentKind[]).sort((a, b) => scores[b] - scores[a]);
  const confidence = Math.max(0, Math.min(1, 0.5 + (scores[ranked[0]] - scores[ranked[1]]) / 2));
  const kind = ranked[0];

  // remoção de ruído só para fala: em canto, música e instrumentos ela estraga o som (o "fundo" é música)
  const noise = kind !== "speech" ? "clean" : snrDb < 18 ? "noisy" : snrDb < 30 ? "some" : "clean";
  const instrument = kind === "instrument" ? guessInstrument({ bassShare, air, snrDb }) : null;
  return { kind, confidence, snrDb, noise, clipping, rumble, features: { syllabic, depth, voiceBand, low, air, harmonicity: harm }, instrument };
}
