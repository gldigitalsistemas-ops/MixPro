/**
 * Motor de mixagem multipista (Mix & Master IA e Voz finalizada). Faz o que um engenheiro faria:
 *
 *   1. Prepara: mesma taxa e tamanho; pista estéreo com L = R vira mono.
 *   2. Fase e tempo: alinha os microfones de bateria ao overhead e pistas da mesma fonte (baixo DI + amp).
 *   3. Por pista (pelo papel): passa-altas, expansor contra vazamento, afinação (voz), de-esser (voz),
 *      cortes de ressonância, EQ de caráter + EQ do usuário, espaço para a voz (corte em 3 kHz nos
 *      instrumentos; bumbo × baixo), compressão adaptada ao nível da pista, volume pelo estilo, pan.
 *   4. Grupos (voz, bateria, baixo, instrumentos): com referência, aproxima o volume relativo e o timbre de
 *      cada grupo dos da referência separada; cola na bateria; automação de volume da voz sobre a música.
 *   5. Reverbs por envio (voz e instrumentos) no tamanho do estilo.
 *   6. Bus: compressão de cola → pré-master (−6 dBFS de pico) → master (preset) → loudness da entrega com
 *      teto de −1 dBTP. Também gera instrumental e a capella.
 *
 * Tudo vem de medidas do próprio áudio; o usuário ajusta por cima (volume, pan, EQ, compressão, reverb,
 * afinação, mudo) e manda mixar de novo.
 */
import type { ChainDoc } from "@/lib/dsp/chain";
import { finalizeForSocial, runChain } from "@/lib/dsp/chain";
import { fft } from "@/lib/dsp/convolve";
import { compressor, gate } from "@/lib/dsp/dynamics";
import { applySections, butterworth, eqPeak, eqShelf, highpass, lowpass } from "@/lib/dsp/filters";
import { integratedLoudness, samplePeak } from "@/lib/dsp/loudness";
import { reverb } from "@/lib/dsp/space";
import type { Signal } from "@/lib/dsp/types";
import { octaveSpectrumDb } from "@/lib/tools/analysis";
import { applyOctaveEq, tonalDiff, toRate } from "@/lib/tools/mixing";
import type { MixGenre, MixTrack, TrackRole } from "@mixpro/contracts";
import { ALIGN_MIN_CORR, applyAlignment, measureAlignment } from "./align";
import { tuneVocal } from "./pitch";
import { GENRE, ROLE, targetLevel, type Group } from "./roles";

export type EngineTrack = { audio: Signal; sr: number; user: MixTrack };

export type ReferenceStems = { vocals: Signal; drums: Signal; bass: Signal; other: Signal; sr: number };

export type EngineOptions = {
  genre: MixGenre;
  align: boolean;
  refAmount: number;
  reference?: ReferenceStems | null;
  masterChain: ChainDoc | null;
  targetLufs: number;
  /** Escala da música (para a afinação) e melodia do compositor (opcional). */
  scale?: number[];
  melody?: [number, number, number][] | null;
};

export type TrackDecision = {
  name: string;
  role: TrackRole;
  /** Volume aplicado pelo motor (dB, antes do ajuste do usuário). */
  auto_gain_db: number;
  gain_db: number;
  pan: number;
  hpf_hz: number;
  gate: boolean;
  comp_ratio: number;
  notches_hz: number[];
  tune_cents: number;
  delay_ms: number;
  polarity_flipped: boolean;
  silent: boolean;
};

export type EngineResult = {
  sr: number;
  master: Signal;
  premaster: Signal;
  instrumental: Signal;
  acapella: Signal;
  /** Pistas como entraram na soma (volume, pan e grupo aplicados), na escala do pré-master. */
  stems: Signal[];
  decisions: TrackDecision[];
  report: Record<string, unknown>;
};

const db = (v: number) => 20 * Math.log10(Math.max(v, 1e-12));
const copyOf = (x: Signal) => x.map((c) => c.slice()) as Signal;
const len = (x: Signal) => x[0]?.length ?? 0;

/** Níveis em quadros de 50 ms (dB RMS): base (p10), pico (p95) e média das partes com som. */
export function levelStats(x: Signal, sr: number) {
  const n = len(x);
  const hop = Math.max(1, Math.round(0.05 * sr));
  const frames: number[] = [];
  for (let s = 0; s + hop <= n; s += hop) {
    let e = 0;
    for (const ch of x) for (let i = s; i < s + hop; i++) e += ch[i] * ch[i];
    frames.push(10 * Math.log10(e / (hop * x.length) + 1e-20));
  }
  const sorted = [...frames].sort((a, b) => a - b);
  const p = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? -120;
  const floor = p(0.1);
  const top = p(0.95);
  // sinal contínuo (sem pausas): tudo conta como "com som"
  const thr = top - floor > 12 ? Math.max(floor + 6, top - 30) : floor - 1;
  const act = frames.filter((f) => f > thr);
  const activeRms = act.length ? 10 * Math.log10(act.reduce((a, f) => a + 10 ** (f / 10), 0) / act.length) : -120;
  return { floor, top, activeRms, activeShare: frames.length ? act.length / frames.length : 0 };
}

/** Correlação L×R (1 = mono disfarçado de estéreo). */
function lrCorrelation(x: Signal): number {
  if (x.length < 2) return 1;
  let ab = 0;
  let aa = 0;
  let bb = 0;
  const [l, r] = x;
  for (let i = 0; i < l.length; i += 4) {
    ab += l[i] * r[i];
    aa += l[i] * l[i];
    bb += r[i] * r[i];
  }
  return aa && bb ? ab / Math.sqrt(aa * bb) : 1;
}

/** Espectro médio de longo prazo (dB, FFT de 4096) para achar ressonâncias. */
function longSpectrum(x: Signal, sr: number): { freqs: Float64Array; db: Float64Array } {
  const N = 4096;
  const n = len(x);
  const win = new Float64Array(N).map((_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1)));
  const acc = new Float64Array(N / 2);
  const frames = Math.min(80, Math.max(1, Math.floor(n / N)));
  const step = Math.max(N, Math.floor((n - N) / frames));
  let used = 0;
  for (let s = 0; s + N <= n && used < frames; s += step) {
    const re = new Float64Array(N);
    const im = new Float64Array(N);
    let e = 0;
    for (let i = 0; i < N; i++) {
      let v = 0;
      for (const ch of x) v += ch[s + i];
      v /= x.length;
      re[i] = v * win[i];
      e += v * v;
    }
    if (e / N < 1e-8) continue;
    fft(re, im);
    for (let k = 0; k < N / 2; k++) acc[k] += re[k] * re[k] + im[k] * im[k];
    used++;
  }
  const out = new Float64Array(N / 2);
  for (let k = 0; k < N / 2; k++) out[k] = 10 * Math.log10(acc[k] / Math.max(used, 1) + 1e-20);
  return { freqs: new Float64Array(N / 2).map((_, k) => (k * sr) / N), db: out };
}

/** Ressonâncias: picos estreitos 5+ dB acima da vizinhança de 1/3 de oitava (150 Hz–7 kHz), até 3. */
export function findResonances(x: Signal, sr: number): { f: number; g: number }[] {
  const { freqs, db: spec } = longSpectrum(x, sr);
  const found: { f: number; excess: number }[] = [];
  for (let k = 2; k < spec.length - 2; k++) {
    const f = freqs[k];
    if (f < 150 || f > 7000) continue;
    if (!(spec[k] > spec[k - 1] && spec[k] >= spec[k + 1])) continue;
    const lo = f / 2 ** (1 / 6);
    const hi = f * 2 ** (1 / 6);
    let sum = 0;
    let cnt = 0;
    for (let j = 1; j < spec.length; j++) {
      if (freqs[j] < lo) continue;
      if (freqs[j] > hi) break;
      sum += spec[j];
      cnt++;
    }
    const excess = spec[k] - sum / Math.max(cnt, 1);
    if (excess >= 5) found.push({ f, excess });
  }
  found.sort((a, b) => b.excess - a.excess);
  const picked: { f: number; g: number }[] = [];
  for (const c of found) {
    if (picked.some((p) => Math.abs(Math.log2(p.f / c.f)) < 1 / 3)) continue;
    picked.push({ f: Math.round(c.f), g: -Math.min(4, c.excess - 2) });
    if (picked.length === 3) break;
  }
  return picked;
}

/**
 * De-esser: reduz só a faixa de 5 kHz para cima quando a sibilância domina o som naquele instante
 * (agudos acima de 35% do nível total), como um de-esser de estúdio. Divisão complementar exata.
 */
export function deEss(x: Signal, sr: number, maxDb = 6): Signal {
  const hp = x.map((c) => {
    const h = c.slice();
    applySections(h, butterworth("hp", 2, 5000, sr));
    return h;
  });
  const aAtt = Math.exp(-1 / (0.001 * sr));
  const aRel = Math.exp(-1 / (0.05 * sr));
  let envH = 0;
  let envF = 0;
  const floor = 10 ** (-maxDb / 20);
  for (let i = 0; i < x[0].length; i++) {
    let h = 0;
    let f = 0;
    for (let c = 0; c < x.length; c++) {
      h = Math.max(h, Math.abs(hp[c][i]));
      f = Math.max(f, Math.abs(x[c][i]));
    }
    envH = h > envH ? aAtt * envH + (1 - aAtt) * h : aRel * envH + (1 - aRel) * h;
    envF = f > envF ? aAtt * envF + (1 - aAtt) * f : aRel * envF + (1 - aRel) * f;
    const r = envF > 1e-5 ? envH / envF : 0;
    const g = r > 0.35 ? Math.max(floor, (0.35 / r) ** 1.5) : 1;
    if (g < 1) for (let c = 0; c < x.length; c++) x[c][i] -= hp[c][i] * (1 - g);
  }
  return x;
}

/** Pan de potência constante: mono → estéreo; estéreo → balanço. */
function panned(x: Signal, pan: number): Signal {
  const th = ((Math.max(-1, Math.min(1, pan)) + 1) * Math.PI) / 4;
  const gl = Math.cos(th) * Math.SQRT2;
  const gr = Math.sin(th) * Math.SQRT2;
  if (x.length === 1) {
    const m = x[0];
    const l = new Float32Array(m.length);
    const r = new Float32Array(m.length);
    for (let i = 0; i < m.length; i++) {
      l[i] = m[i] * gl * Math.SQRT1_2;
      r[i] = m[i] * gr * Math.SQRT1_2;
    }
    return [l, r] as Signal;
  }
  const l = x[0].slice();
  const r = x[1].slice();
  const bl = Math.min(1, gl);
  const br = Math.min(1, gr);
  for (let i = 0; i < l.length; i++) {
    l[i] *= bl;
    r[i] *= br;
  }
  return [l, r] as Signal;
}

function addInto(bus: Signal, x: Signal, g = 1) {
  for (let c = 0; c < 2; c++) {
    const src = x[Math.min(c, x.length - 1)];
    const dst = bus[c];
    for (let i = 0; i < dst.length && i < src.length; i++) dst[i] += src[i] * g;
  }
}

const stereo = (n: number) => [new Float32Array(n), new Float32Array(n)] as Signal;

/** Pan automático pelo papel (guitarras/violões dobrados abrem; bateria na posição de palco). */
function autoPan(role: TrackRole, indexInRole: number, countInRole: number, spread: number): number {
  const alt = (i: number) => (i % 2 === 0 ? -1 : 1);
  switch (role) {
    case "lead_vocal":
    case "kick":
    case "snare":
    case "bass":
    case "drums":
    case "room":
    case "loop":
      return 0;
    case "hihat":
      return 0.3;
    case "toms":
      return countInRole <= 1 ? 0 : -0.5 + (indexInRole / (countInRole - 1)) * 1;
    case "overheads":
      return countInRole === 2 ? alt(indexInRole) * 0.8 : 0;
    case "electric_guitar":
    case "acoustic_guitar":
      return countInRole <= 1 ? (role === "acoustic_guitar" ? -0.25 : 0.25) : alt(indexInRole) * spread;
    case "backing_vocal":
      return countInRole <= 1 ? 0 : alt(indexInRole) * 0.45;
    case "percussion":
      return countInRole <= 1 ? -0.35 : alt(indexInRole) * 0.5;
    case "piano":
    case "keys":
      return countInRole <= 1 ? 0.15 : alt(indexInRole) * 0.4;
    default:
      return countInRole <= 1 ? 0 : alt(indexInRole) * 0.5;
  }
}

/** Frequência fundamental do bumbo (pico de 40–100 Hz). */
function kickFundamental(x: Signal, sr: number): number | null {
  const { freqs, db: spec } = longSpectrum(x, sr);
  let best = -1;
  for (let k = 1; k < spec.length; k++) {
    if (freqs[k] < 40) continue;
    if (freqs[k] > 100) break;
    if (best < 0 || spec[k] > spec[best]) best = k;
  }
  return best > 0 ? Math.round(freqs[best]) : null;
}

/** Automação de volume da voz: mantém a voz `target` LU acima da música, suave (±4 dB × 0,6). */
function rideVocals(vocals: Signal, music: Signal, sr: number, target: number): { avg: number; max: number } {
  const n = len(vocals);
  const hop = Math.round(0.1 * sr);
  const win = Math.round(0.4 * sr);
  const frames = Math.max(1, Math.floor((n - win) / hop) + 1);
  const rms = (x: Signal, s: number) => {
    let e = 0;
    for (const ch of x) for (let i = s; i < s + win && i < n; i += 2) e += ch[i] * ch[i];
    return 10 * Math.log10(e / (win * x.length * 0.5) + 1e-20);
  };
  const lv: number[] = [];
  const lm: number[] = [];
  for (let f = 0; f < frames; f++) {
    lv.push(rms(vocals, f * hop));
    lm.push(rms(music, f * hop));
  }
  const vmax = Math.max(...lv);
  const gains = lv.map((v, f) => (v > vmax - 30 ? Math.max(-4, Math.min(4, target - (v - lm[f]))) * 0.6 : 0));
  // suaviza (300 ms) e aplica com interpolação entre quadros
  const a = Math.exp(-1 / 3);
  let s = 0;
  const smooth = gains.map((g) => (s = a * s + (1 - a) * g));
  for (let i = 0; i < n; i++) {
    const fpos = Math.min(frames - 1, Math.max(0, (i - win / 2) / hop));
    const f0 = Math.floor(fpos);
    const g = smooth[f0] + (smooth[Math.min(frames - 1, f0 + 1)] - smooth[f0]) * (fpos - f0);
    const lin = 10 ** (g / 20);
    for (const ch of vocals) ch[i] *= lin;
  }
  const abs = smooth.map(Math.abs);
  return { avg: Math.round((abs.reduce((p, q) => p + q, 0) / abs.length) * 10) / 10, max: Math.round(Math.max(...abs) * 10) / 10 };
}

/** Nível de trabalho da voz principal antes do master (LUFS). */
const ANCHOR = -20;

export function mixSession(input: EngineTrack[], o: EngineOptions): EngineResult {
  if (!input.length) throw new Error("sem pistas");
  // 1. mesma taxa (a mais comum) e mesmo tamanho
  const rates = input.map((t) => t.sr);
  const sr = rates.sort((a, b) => rates.filter((r) => r === b).length - rates.filter((r) => r === a).length)[0];
  const n = Math.max(...input.map((t) => Math.round((len(t.audio) * sr) / t.sr)));
  const genre = GENRE[o.genre];
  const roles = input.map((t) => t.user.role);
  const hasVocal = roles.some((r) => r === "lead_vocal" || r === "backing_vocal");

  let tracks: Signal[] = input.map((t) => {
    let a = t.sr === sr ? t.audio : toRate(t.audio, t.sr, sr);
    if (a.length === 2 && lrCorrelation(a) > 0.995) a = [a[0]] as Signal;
    if (len(a) < n) a = a.map((c) => {
      const p = new Float32Array(n);
      p.set(c);
      return p;
    }) as Signal;
    return a;
  });

  const decisions: TrackDecision[] = input.map((t, i) => ({
    name: t.user.name,
    role: t.user.role,
    auto_gain_db: 0,
    gain_db: 0,
    pan: 0,
    hpf_hz: ROLE[t.user.role].hpf,
    gate: false,
    comp_ratio: 1,
    notches_hz: [],
    tune_cents: 0,
    delay_ms: 0,
    polarity_flipped: false,
    silent: levelStats(tracks[i], sr).activeRms < -70,
  }));

  // 2. fase e tempo
  if (o.align) {
    const drumIdx = roles.map((r, i) => (["kick", "snare", "toms", "hihat", "overheads", "percussion"].includes(r) ? i : -1)).filter((i) => i >= 0);
    const oh = roles.findIndex((r) => r === "overheads");
    const ref = oh >= 0 ? oh : roles.findIndex((r) => r === "snare");
    const pairs: [number, number[]][] = [];
    if (ref >= 0) pairs.push([ref, drumIdx.filter((i) => i !== ref && roles[i] !== "overheads")]);
    for (const role of ["bass", "acoustic_guitar"] as TrackRole[]) {
      const same = roles.map((r, i) => (r === role ? i : -1)).filter((i) => i >= 0);
      if (same.length > 1) pairs.push([same[0], same.slice(1)]);
    }
    for (const [r, others] of pairs) {
      for (const i of others) {
        if (decisions[i].silent) continue;
        const m = measureAlignment(tracks[r], tracks[i], sr);
        if (m.corr < ALIGN_MIN_CORR) continue;
        if (m.lag !== 0 || m.flip) {
          tracks[i] = applyAlignment(tracks[i], m.lag, m.flip);
          decisions[i].delay_ms = Math.round((m.lag / sr) * 10000) / 10;
          decisions[i].polarity_flipped = m.flip;
        }
      }
    }
  }

  const kickIdx = roles.findIndex((r) => r === "kick");
  const kickF = kickIdx >= 0 && !decisions[kickIdx].silent ? kickFundamental(tracks[kickIdx], sr) : null;
  const countOf = (role: TrackRole) => roles.filter((r, i) => r === role && !input[i].user.mute).length;
  const seenOf: Partial<Record<TrackRole, number>> = {};

  // 3. por pista
  const processed: { audio: Signal; group: Group; pan: number; send: number }[] = [];
  input.forEach((t, i) => {
    const u = t.user;
    const cfg = ROLE[u.role];
    const d = decisions[i];
    let x = copyOf(tracks[i]);
    tracks[i] = [] as unknown as Signal; // libera a memória da entrada
    if (d.silent || u.mute) {
      processed.push({ audio: [new Float32Array(n)] as Signal, group: cfg.group, pan: 0, send: 0 });
      d.silent = d.silent || u.mute;
      return;
    }
    x = highpass(x, sr, { frequency_hz: cfg.hpf, slope_db_oct: u.role.includes("vocal") ? "18" : "12" });
    const st = levelStats(x, sr);
    if (cfg.gate && st.top - st.floor > 18) {
      const drum = cfg.group === "drums";
      x = gate(x, sr, { threshold_db: drum ? st.floor + 0.5 * (st.top - st.floor) : st.floor + 8, range_db: drum ? 18 : 10, ratio: 2, attack_ms: 1, hold_ms: drum ? 50 : 90, release_ms: drum ? 90 : 160 });
      d.gate = true;
    }
    if ((u.role === "lead_vocal" || u.role === "backing_vocal") && u.tune > 0) {
      const r = tuneVocal(x, sr, { amount: u.tune / 100, scale: o.scale, melody: u.role === "lead_vocal" ? o.melody : null });
      x = r.out;
      d.tune_cents = r.report.avgCents;
    }
    if (u.role === "lead_vocal" || u.role === "backing_vocal") x = deEss(x, sr, 6);
    if (cfg.resonances) {
      const notches = findResonances(x, sr);
      for (const nn of notches) x = eqPeak(x, sr, { frequency_hz: nn.f, gain_db: nn.g, q: 5 });
      d.notches_hz = notches.map((nn) => nn.f);
    }
    for (const e of cfg.eq) x = e.shelf ? eqShelf(x, sr, { position: e.shelf, frequency_hz: e.f, gain_db: e.g, q: e.q }) : eqPeak(x, sr, { frequency_hz: e.f, gain_db: e.g, q: e.q });
    x = eqShelf(x, sr, { position: "low", frequency_hz: 120, gain_db: u.eq_low, q: 0.7 });
    x = eqPeak(x, sr, { frequency_hz: 1000, gain_db: u.eq_mid, q: 0.8 });
    x = eqShelf(x, sr, { position: "high", frequency_hz: 8000, gain_db: u.eq_high, q: 0.7 });
    if (cfg.carve && hasVocal) x = eqPeak(x, sr, { frequency_hz: 3000, gain_db: -2, q: 0.9 });
    if (u.role === "bass" && kickF) x = eqPeak(x, sr, { frequency_hz: kickF, gain_db: -2.5, q: 2 });
    if (cfg.comp) {
      const factor = u.comp === null ? 1 : (u.comp / 100) * 2;
      const ratio = 1 + (cfg.comp.ratio - 1) * factor;
      if (ratio > 1.05) {
        const s2 = levelStats(x, sr);
        x = compressor(x, sr, { threshold_db: s2.activeRms + cfg.comp.above, ratio, attack_ms: cfg.comp.attack, release_ms: cfg.comp.release, knee_db: 6, makeup_db: 0 });
      }
      d.comp_ratio = Math.round(ratio * 10) / 10;
    }
    // volume pelo estilo: cada pista no nível relativo do seu papel (dividido entre pistas do mesmo papel)
    const lufs = integratedLoudness(x, sr);
    const split = 10 * Math.log10(Math.max(1, countOf(u.role)));
    const auto = Number.isFinite(lufs) ? Math.max(-40, Math.min(40, ANCHOR + targetLevel(u.role, o.genre) - split - lufs)) : 0;
    d.auto_gain_db = Math.round(auto * 10) / 10;
    d.gain_db = Math.round((auto + u.gain_db) * 10) / 10;
    const g = 10 ** ((auto + u.gain_db) / 20);
    for (const ch of x) for (let k = 0; k < ch.length; k++) ch[k] *= g;
    const k = seenOf[u.role] ?? 0;
    seenOf[u.role] = k + 1;
    d.pan = u.pan ?? Math.round(autoPan(u.role, k, countOf(u.role), genre.spread) * 100) / 100;
    const send = u.reverb === null ? cfg.reverb * genre.reverb.send : (u.reverb / 100) * 0.5;
    processed.push({ audio: x, group: cfg.group, pan: d.pan, send });
  });

  // 4. grupos
  const buses: Record<Group, Signal> = { vocals: stereo(n), drums: stereo(n), bass: stereo(n), other: stereo(n) };
  const vocalSend = stereo(n);
  const instSend = stereo(n);
  const stemsPanned: Signal[] = processed.map((p) => {
    const s = panned(p.audio, p.pan);
    addInto(buses[p.group], s);
    if (p.send > 0) addInto(p.group === "vocals" ? vocalSend : instSend, s, p.send);
    return s;
  });
  processed.length = 0;

  const groupReport: Record<string, unknown> = {};
  const L = (x: Signal) => integratedLoudness(x, sr);
  if (o.reference && o.refAmount > 0) {
    const ref = o.reference;
    const refRate = (x: Signal) => (ref.sr === sr ? x : toRate(x, ref.sr, sr));
    const refStems: Record<Group, Signal> = { vocals: refRate(ref.vocals), drums: refRate(ref.drums), bass: refRate(ref.bass), other: refRate(ref.other) };
    const anchorOurs = hasVocal ? L(buses.vocals) : L(buses.drums);
    const anchorRef = hasVocal ? L(refStems.vocals) : L(refStems.drums);
    for (const g of ["drums", "bass", "other", "vocals"] as Group[]) {
      const ours = L(buses[g]);
      const theirs = L(refStems[g]);
      if (!Number.isFinite(ours) || !Number.isFinite(theirs)) continue;
      let delta = 0;
      if (!(hasVocal && g === "vocals") && Number.isFinite(anchorOurs) && Number.isFinite(anchorRef)) {
        delta = Math.max(-6, Math.min(6, (theirs - anchorRef - (ours - anchorOurs)) * o.refAmount));
      }
      const eq = tonalDiff(octaveSpectrumDb(buses[g], sr), octaveSpectrumDb(refStems[g], sr), 4).map((v) => v * o.refAmount);
      buses[g] = applyOctaveEq(buses[g], sr, eq);
      if (Math.abs(delta) > 0.05) {
        const lin = 10 ** (delta / 20);
        for (const ch of buses[g]) for (let i = 0; i < ch.length; i++) ch[i] *= lin;
        stemsPanned.forEach((s, i) => {
          if (ROLE[roles[i]].group === g) for (const ch of s) for (let k = 0; k < ch.length; k++) ch[k] *= lin;
        });
      }
      groupReport[g] = { volume_db: Math.round(delta * 10) / 10, eq_db: eq.map((v) => Math.round(v * 10) / 10) };
    }
  }

  // cola da bateria (punch)
  {
    const s = levelStats(buses.drums, sr);
    if (s.activeRms > -70) buses.drums = compressor(buses.drums, sr, { threshold_db: s.activeRms + 5, ratio: 2.5, attack_ms: 20, release_ms: 110, knee_db: 6, makeup_db: 0 });
  }

  const music = stereo(n);
  addInto(music, buses.drums);
  addInto(music, buses.bass);
  addInto(music, buses.other);
  const riding = hasVocal ? rideVocals(buses.vocals, music, sr, genre.vocalOverMusic) : { avg: 0, max: 0 };

  // 5. reverbs por envio
  const rv = (send: Signal, room: number) => {
    const s = highpass(send, sr, { frequency_hz: 250, slope_db_oct: "12" });
    const w = reverb(s, sr, { room_size: room, damping: 50, width: 100, predelay_ms: genre.reverb.predelay, mix: 100 });
    return lowpass(w, sr, { frequency_hz: 9000, slope_db_oct: "12" });
  };
  const vocalVerb = hasVocal ? rv(vocalSend, genre.reverb.room) : stereo(n);
  const instVerb = rv(instSend, Math.round(genre.reverb.room * 0.8));

  // 6. bus, pré-master e master
  let mix = stereo(n);
  addInto(mix, buses.vocals);
  addInto(mix, music);
  addInto(mix, vocalVerb);
  addInto(mix, instVerb);
  {
    const s = levelStats(mix, sr);
    mix = compressor(mix, sr, { threshold_db: s.activeRms + 5, ratio: 1.8, attack_ms: 30, release_ms: 200, knee_db: 6, makeup_db: 0 });
  }
  const peak = samplePeak(mix);
  const scale = peak > 1e-9 ? 10 ** (-6 / 20) / peak : 1;
  const scaled = (x: Signal) => {
    for (const ch of x) for (let i = 0; i < ch.length; i++) ch[i] *= scale;
    return x;
  };
  const premaster = scaled(mix);
  stemsPanned.forEach(scaled);

  const master = (x: Signal) => {
    let y = copyOf(x);
    if (o.masterChain) y = runChain(y, sr, o.masterChain, 100);
    return finalizeForSocial(y, sr, o.targetLufs, -1);
  };
  const out = master(premaster);

  const inst = stereo(n);
  addInto(inst, music);
  addInto(inst, instVerb);
  const instrumental = master(scaled(inst));
  const acap = stereo(n);
  addInto(acap, buses.vocals);
  addInto(acap, vocalVerb);
  scaled(acap);
  const ap = samplePeak(acap);
  if (ap > 1e-9) {
    const g = 10 ** (-1 / 20) / ap;
    for (const ch of acap) for (let i = 0; i < ch.length; i++) ch[i] *= g;
  }

  return {
    sr,
    master: out,
    premaster,
    instrumental,
    acapella: acap,
    stems: stemsPanned,
    decisions,
    report: {
      estilo: genre.name,
      lufs: Math.round(L(out) * 10) / 10,
      pico_db: Math.round(db(samplePeak(out)) * 10) / 10,
      automacao_voz_db: riding,
      referencia: o.reference ? groupReport : null,
      pistas: decisions.length,
    },
  };
}
