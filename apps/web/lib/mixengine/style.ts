/**
 * Retrato sonoro de uma música (a referência do compositor) e o prompt de estilo para o gerador de covers.
 *
 * O gerador (MiniMax Music Cover) recebe só a guia e um texto de até 300 caracteres. A referência nunca vai ao
 * gerador (seria um cover dela): o app mede o que define o som dela — andamento, tom, peso da bateria e do baixo,
 * graves, brilho, largura, volume, dinâmica, groove e o tipo de voz — e traduz em descritores curtos em inglês,
 * a língua em que o modelo entende melhor as instruções de produção.
 */
import { fft } from "@/lib/dsp/convolve";
import { integratedLoudness, samplePeak } from "@/lib/dsp/loudness";
import type { Signal } from "@/lib/dsp/types";
import { detectBpm, detectKey } from "@/lib/tools/analysis";
import { trackPitch } from "./pitch";

export type StemSet = { drums: Signal; bass: Signal; other: Signal; vocals: Signal };

export type StyleProfile = {
  bpm: number | null;
  key: { tonic: number; mode: "major" | "minor" } | null;
  lufs: number;
  crestDb: number;
  /** % da energia por faixa: sub (<60 Hz), graves (60–250), médios (250–2k), presença (2–6k), ar (>6k). */
  bands: { sub: number; low: number; mid: number; presence: number; air: number };
  rolloffHz: number;
  /** Energia do lado (L−R) sobre o meio (L+R). */
  width: number;
  /** Diferença (dB) entre os trechos mais altos e os mais baixos: músicas com construção e explosão. */
  arcDb: number;
  /** Peso de cada parte em dB relativo à mistura (com as faixas separadas). */
  stems: { drums: number; bass: number; other: number; vocals: number } | null;
  /** Ataques de bateria por tempo (≈2 = colcheias, ≈4 = semicolcheias). */
  hitsPerBeat: number | null;
  /** Voz principal: altura mediana (MIDI) e registro provável. */
  voice: { medianMidi: number; register: "male" | "female" | null } | null;
};

const EN_NOTES = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];

function mono(x: Signal): Float32Array {
  const n = x[0]?.length ?? 0;
  const m = new Float32Array(n);
  for (const c of x) for (let i = 0; i < n; i++) m[i] += c[i] / x.length;
  return m;
}

function energy(x: Signal): number {
  let e = 0;
  for (const c of x) for (let i = 0; i < c.length; i += 4) e += c[i] * c[i];
  return e;
}

function spectrum(x: Float32Array, sr: number) {
  const n = 4096;
  const frames = 48;
  const acc = new Float64Array(n / 2);
  for (let f = 0; f < frames; f++) {
    const start = Math.floor(((f + 0.5) / frames) * Math.max(0, x.length - n));
    const re = new Float64Array(n);
    const im = new Float64Array(n);
    for (let i = 0; i < n; i++) re[i] = (x[start + i] ?? 0) * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1)));
    fft(re, im);
    for (let k = 0; k < n / 2; k++) acc[k] += re[k] * re[k] + im[k] * im[k];
  }
  const hz = (k: number) => (k * sr) / n;
  let total = 0;
  for (let k = 1; k < n / 2; k++) total += acc[k];
  const share = (a: number, b: number) => {
    let s = 0;
    for (let k = 1; k < n / 2; k++) if (hz(k) >= a && hz(k) < b) s += acc[k];
    return total > 0 ? Math.round((1000 * s) / total) / 10 : 0;
  };
  let run = 0;
  let rolloff = sr / 2;
  for (let k = 1; k < n / 2; k++) {
    run += acc[k];
    if (run >= total * 0.995) {
      rolloff = hz(k);
      break;
    }
  }
  return {
    bands: { sub: share(20, 60), low: share(60, 250), mid: share(250, 2000), presence: share(2000, 6000), air: share(6000, sr / 2) },
    rolloffHz: Math.round(rolloff),
  };
}

/** Ataques por segundo na bateria (picos do fluxo de energia em bandas de 10 ms). */
function hitsPerSecond(drums: Float32Array, sr: number): number {
  const hop = Math.round(sr / 100);
  const env: number[] = [];
  for (let i = 0; i + hop <= drums.length; i += hop) {
    let s = 0;
    for (let k = i; k < i + hop; k++) s += drums[k] * drums[k];
    env.push(Math.log1p(1000 * s / hop));
  }
  const flux = env.map((v, i) => Math.max(0, v - (env[i - 1] ?? v)));
  const sorted = [...flux].sort((a, b) => a - b);
  const thr = sorted[Math.floor(sorted.length * 0.9)] ?? 0;
  let hits = 0;
  let last = -10;
  for (let i = 1; i < flux.length - 1; i++) {
    if (flux[i] > thr && flux[i] >= flux[i - 1] && flux[i] >= flux[i + 1] && i - last >= 8) {
      hits++;
      last = i;
    }
  }
  return hits / (drums.length / sr);
}

/** Registro da voz pela altura mediana: homens cantam em torno de Dó3–Dó4, mulheres de Lá3–Lá4. */
export function voiceOf(vocals: Signal, sr: number): StyleProfile["voice"] {
  // o meio da música basta (até 60 s): o YIN em 4 minutos é lento à toa
  const n = vocals[0].length;
  const span = Math.min(n, 60 * sr);
  const start = Math.max(0, Math.floor((n - span) / 2));
  const part = vocals.map((c) => c.slice(start, start + span)) as Signal;
  const t = trackPitch(part, sr);
  const midi: number[] = [];
  for (let i = 0; i < t.f0.length; i++) if (t.voiced[i] && t.f0[i] > 0) midi.push(69 + 12 * Math.log2(t.f0[i] / 440));
  if (midi.length < 100) return null;
  midi.sort((a, b) => a - b);
  const med = midi[Math.floor(midi.length / 2)];
  return { medianMidi: Math.round(med * 10) / 10, register: med < 61.5 ? "male" : med > 63.5 ? "female" : null };
}

export function analyzeStyle(x: Signal, sr: number, stems?: StemSet | null): StyleProfile {
  const m = mono(x);
  const bpm = detectBpm(x, sr);
  const key = detectKey(stems ? stems.other : x, sr);
  const lufs = integratedLoudness(x, sr);
  let rms = 0;
  for (let i = 0; i < m.length; i += 2) rms += m[i] * m[i];
  rms = Math.sqrt(rms / Math.max(1, m.length / 2));
  const crestDb = 20 * Math.log10(samplePeak(x) / Math.max(1e-9, rms));
  const { bands, rolloffHz } = spectrum(m, sr);
  let mid = 0;
  let side = 0;
  if (x.length > 1) {
    for (let i = 0; i < x[0].length; i += 4) {
      const a = x[0][i];
      const b = x[1][i];
      mid += (a + b) ** 2;
      side += (a - b) ** 2;
    }
  }
  // trechos de 5 s: diferença entre os 10% mais altos e os 10% mais baixos (ignorando silêncio)
  const win = 5 * sr;
  const levels: number[] = [];
  for (let s = 0; s + win <= m.length; s += win) {
    let e = 0;
    for (let i = s; i < s + win; i += 4) e += m[i] * m[i];
    const db = 10 * Math.log10(e / (win / 4) + 1e-12);
    if (db > -60) levels.push(db);
  }
  levels.sort((a, b) => a - b);
  const arcDb = levels.length >= 4 ? levels[Math.floor(levels.length * 0.9)] - levels[Math.floor(levels.length * 0.1)] : 0;
  let stemDb: StyleProfile["stems"] = null;
  let hitsPerBeat: number | null = null;
  let voice: StyleProfile["voice"] = null;
  if (stems) {
    const tot = energy(x) + 1e-12;
    const rel = (s: Signal) => Math.round(10 * Math.log10(energy(s) / tot + 1e-12));
    stemDb = { drums: rel(stems.drums), bass: rel(stems.bass), other: rel(stems.other), vocals: rel(stems.vocals) };
    if (bpm && stemDb.drums > -20) hitsPerBeat = Math.round((hitsPerSecond(mono(stems.drums), sr) / (bpm.bpm / 60)) * 10) / 10;
    if (stemDb.vocals > -18) voice = voiceOf(stems.vocals, sr);
  }
  return {
    bpm: bpm ? Math.round(bpm.bpm) : null,
    key: key ? { tonic: key.tonic, mode: key.mode } : null,
    lufs: Math.round(lufs * 10) / 10,
    crestDb: Math.round(crestDb * 10) / 10,
    bands,
    rolloffHz,
    width: mid > 0 ? Math.round((side / mid) * 100) / 100 : 0,
    arcDb: Math.round(arcDb * 10) / 10,
    stems: stemDb,
    hitsPerBeat,
    voice,
  };
}

/** Descritores de produção (inglês, curtos), do mais marcante ao mais sutil. */
export function styleDescriptors(p: StyleProfile): string[] {
  const d: string[] = [];
  const s = p.stems;
  if (s && s.drums >= -6) d.push("punchy drum-forward mix");
  else if (s && s.drums <= -16) d.push("soft light percussion");
  if (p.bands.sub + p.bands.low >= 55 || (s && s.bass >= -6)) d.push(p.bands.sub >= 20 ? "deep heavy sub bass" : "big warm bass");
  if (p.hitsPerBeat !== null) d.push(p.hitsPerBeat >= 3 ? "busy 16th-note groove" : p.hitsPerBeat <= 1.4 ? "spacious half-time feel" : "steady eighth-note groove");
  if (p.rolloffHz >= 15000 && p.bands.air >= 3) d.push("bright airy highs");
  else if (p.rolloffHz < 9000) d.push("warm vintage tone");
  if (s && s.other >= -8) d.push("lush layered keys and guitars");
  if (p.width >= 0.3) d.push("wide stereo");
  if (p.arcDb >= 8) d.push("dynamic build-ups");
  if (p.lufs >= -10) d.push("loud polished modern master");
  else if (p.crestDb >= 16) d.push("open natural dynamics");
  if (s && s.vocals >= -5) d.push("vocal-forward mix");
  return d;
}

const LANGUAGES: Record<string, string> = {
  pt: "Brazilian Portuguese",
  es: "Spanish",
  en: "English",
  it: "Italian",
  fr: "French",
  de: "German",
};

export type CoverPromptInput = {
  /** Gênero escolhido (descrição curta em inglês). */
  genre: string;
  /** Descrição livre da pessoa (já limpa). */
  userStyle?: string;
  /** Idioma cantado na guia (código do Whisper). */
  language?: string | null;
  /** Voz da IA: a da guia por padrão. */
  register?: "male" | "female" | null;
  bpm?: number | null;
  key?: { tonic: number; mode: "major" | "minor" } | null;
  reference?: StyleProfile | null;
};

/** Monta o prompt (até `max` caracteres) tirando primeiro os detalhes menos importantes. */
export function coverPrompt(i: CoverPromptInput, max = 300): string {
  const lang = LANGUAGES[i.language ?? "pt"] ?? "Brazilian Portuguese";
  const voice = `${lang} ${i.register === "female" ? "female " : i.register === "male" ? "male " : ""}lead vocal, native pronunciation`;
  const musical = [i.key ? `${EN_NOTES[i.key.tonic]} ${i.key.mode}` : null, i.bpm ? `${Math.round(i.bpm)} BPM` : null].filter(Boolean).join(", ");
  const must = ["Faithful cover, same vocal melody, phrasing and lyrics", voice, musical].filter(Boolean);
  const optional = [i.genre, i.userStyle ?? "", ...(i.reference ? styleDescriptors(i.reference) : [])].map((s) => s.trim()).filter(Boolean);
  const parts = [...must];
  for (const o of optional) {
    if ([...parts, o].join(", ").length <= max) parts.push(o);
  }
  return parts.join(", ").slice(0, max);
}
