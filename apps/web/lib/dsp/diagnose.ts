/**
 * Medição e diagnóstico do áudio: tudo é calculado do sinal (nada é estimado ou inventado).
 * Só mede: não altera o áudio nem entra na cadeia de processamento.
 *
 * Medidas: pico, true peak (4× oversampling), RMS, LUFS integrado, LRA, ruído de fundo, faixa
 * dinâmica (PLR), clipping, DC offset, silêncio, equilíbrio e correlação estéreo e energia por faixa.
 */
import { applySections, butterworth } from "./filters";
import { integratedLoudness, samplePeak } from "./loudness";
import type { Signal } from "./types";

export const BANDS = [
  { id: "sub", label: "Sub", lo: 20, hi: 60 },
  { id: "low", label: "Graves", lo: 60, hi: 250 },
  { id: "lowMid", label: "Médio-graves", lo: 250, hi: 800 },
  { id: "mid", label: "Médios", lo: 800, hi: 2500 },
  { id: "highMid", label: "Médio-agudos", lo: 2500, hi: 6000 },
  { id: "high", label: "Agudos", lo: 6000, hi: 16000 },
] as const;
export type BandId = (typeof BANDS)[number]["id"];

export type Measurements = {
  durationS: number;
  sampleRate: number;
  channels: number;
  /** Pico de amostra (dBFS). */
  peakDb: number;
  /** Pico real entre amostras (dBTP, oversampling 4×). */
  truePeakDb: number;
  rmsDb: number;
  /** Loudness integrada (LUFS, BS.1770-4); null se curto demais ou silencioso. */
  lufs: number | null;
  /** Faixa de loudness (LU), curto prazo de 3 s; null se o áudio tem menos de ~10 s. */
  lra: number | null;
  /** Nível das partes mais baixas com som (dBFS RMS, percentil 10 de janelas de 100 ms). */
  noiseFloorDb: number;
  /** Pico − loudness integrada (dB): quanto o pico passa da média. null sem LUFS. */
  plrDb: number | null;
  /** Fração das amostras em clipping (trechos de 3 ou mais amostras seguidas no limite). */
  clipping: number;
  /** Maior média (valor absoluto) por canal: componente contínua. */
  dcOffset: number;
  /** Fração do tempo abaixo de -60 dBFS. */
  silence: number;
  /** Diferença L−R em dB (0 = equilibrado); null em mono. */
  balanceDb: number | null;
  /** Correlação L/R de −1 a 1; null em mono. */
  correlation: number | null;
  /** Fração da energia (0–1) em cada faixa de frequência. */
  bands: Record<BandId, number>;
};

const db = (v: number) => 20 * Math.log10(Math.max(v, 1e-9));
const pctile = (v: number[], p: number) => {
  if (!v.length) return NaN;
  const s = Float64Array.from(v).sort();
  return s[Math.min(s.length - 1, Math.floor(p * (s.length - 1)))];
};

/** Interpolador 4× (sinc com janela de Hann, 12 pontos): só onde o sinal está perto do pico. */
const OS_TAPS = 6;
const OS_KERNEL = [1, 2, 3].map((p) => {
  const frac = p / 4;
  const h: number[] = [];
  for (let k = -OS_TAPS + 1; k <= OS_TAPS; k++) {
    const t = k - frac;
    const sinc = Math.sin(Math.PI * t) / (Math.PI * t);
    const w = 0.5 * (1 + Math.cos((Math.PI * t) / (OS_TAPS + 0.5)));
    h.push(sinc * w);
  }
  return h;
});

export function truePeak(audio: Signal): number {
  const peak = samplePeak(audio);
  if (peak <= 0) return 0;
  const gate = peak * 0.5;
  let best = peak;
  for (const ch of audio) {
    const n = ch.length;
    for (let i = 0; i < n - 1; i++) {
      if (Math.abs(ch[i]) < gate && Math.abs(ch[i + 1]) < gate) continue;
      for (const h of OS_KERNEL) {
        let s = 0;
        for (let j = 0; j < h.length; j++) {
          const idx = i + j - OS_TAPS + 1;
          if (idx >= 0 && idx < n) s += ch[idx] * h[j];
        }
        const a = Math.abs(s);
        if (a > best) best = a;
      }
    }
  }
  return best;
}

function clippedFraction(audio: Signal, peak: number): number {
  if (peak < 0.985) return 0;
  const lim = Math.max(0.985, peak * 0.999);
  let count = 0;
  let total = 0;
  for (const ch of audio) {
    total += ch.length;
    let run = 0;
    for (let i = 0; i < ch.length; i++) {
      if (Math.abs(ch[i]) >= lim) run++;
      else {
        if (run >= 3) count += run;
        run = 0;
      }
    }
    if (run >= 3) count += run;
  }
  return total ? count / total : 0;
}

function bandEnergy(x: Float32Array, sr: number, lo: number, hi: number): number {
  const top = Math.min(hi, sr / 2 - 100);
  if (top <= lo) return 0;
  const y = x.slice();
  applySections(y, [...butterworth("hp", 4, lo, sr), ...butterworth("lp", 4, top, sr)]);
  let s = 0;
  for (let i = 0; i < y.length; i += 2) s += y[i] * y[i];
  return s;
}

export function measureAudio(audio: Signal, sr: number): Measurements {
  const n = audio[0]?.length ?? 0;
  const peak = samplePeak(audio);
  const tp = truePeak(audio);

  // mono para RMS, janelas e bandas
  const mono = new Float32Array(n);
  for (const ch of audio) for (let i = 0; i < n; i++) mono[i] += ch[i] / audio.length;

  let sq = 0;
  for (let i = 0; i < n; i++) sq += mono[i] * mono[i];
  const rms = Math.sqrt(sq / Math.max(1, n));

  // janelas de 100 ms: ruído de fundo e silêncio
  const w = Math.max(1, Math.round(sr * 0.1));
  const frames: number[] = [];
  let silent = 0;
  for (let s = 0; s + w <= n; s += w) {
    let e = 0;
    for (let i = s; i < s + w; i++) e += mono[i] * mono[i];
    const level = db(Math.sqrt(e / w));
    if (level < -60) silent++;
    else frames.push(level);
  }
  const totalFrames = Math.max(1, Math.floor(n / w));
  const noiseFloorDb = frames.length ? pctile(frames, 0.1) : -120;

  const lufs = (() => {
    const v = integratedLoudness(audio, sr);
    return Number.isFinite(v) ? v : null;
  })();

  // LRA: loudness de curto prazo (3 s, passo de 1 s) com portão relativo de -20 LU
  let lra: number | null = null;
  if (n >= sr * 10) {
    const win = Math.round(sr * 3);
    const step = sr;
    const levels: number[] = [];
    for (let s = 0; s + win <= n; s += step) {
      const l = integratedLoudness(audio.map((c) => c.subarray(s, s + win)) as Signal, sr);
      if (Number.isFinite(l) && l > -70) levels.push(l);
    }
    if (levels.length >= 3) {
      const mean = 10 * Math.log10(levels.reduce((a, l) => a + 10 ** (l / 10), 0) / levels.length);
      const gated = levels.filter((l) => l > mean - 20);
      if (gated.length >= 3) lra = pctile(gated, 0.95) - pctile(gated, 0.1);
    }
  }

  let dc = 0;
  for (const ch of audio) {
    let m = 0;
    for (let i = 0; i < n; i++) m += ch[i];
    dc = Math.max(dc, Math.abs(m / Math.max(1, n)));
  }

  let balanceDb: number | null = null;
  let correlation: number | null = null;
  if (audio.length >= 2) {
    const [l, r] = audio;
    let ll = 0;
    let rr = 0;
    let lr = 0;
    for (let i = 0; i < n; i++) {
      ll += l[i] * l[i];
      rr += r[i] * r[i];
      lr += l[i] * r[i];
    }
    balanceDb = ll > 0 && rr > 0 ? 10 * Math.log10(ll / rr) : 0;
    correlation = ll > 0 && rr > 0 ? lr / Math.sqrt(ll * rr) : 1;
  }

  // bandas: até 60 s do meio do arquivo (como o analisador automático)
  let seg = mono;
  const maxLen = sr * 60;
  if (seg.length > maxLen) {
    const start = Math.floor((seg.length - maxLen) / 2);
    seg = seg.slice(start, start + maxLen);
  }
  const energies = BANDS.map((b) => bandEnergy(seg, sr, b.lo, b.hi));
  const sum = energies.reduce((a, b) => a + b, 0) || 1;
  const bands = Object.fromEntries(BANDS.map((b, i) => [b.id, energies[i] / sum])) as Record<BandId, number>;

  return {
    durationS: n / sr,
    sampleRate: sr,
    channels: audio.length,
    peakDb: db(peak),
    truePeakDb: db(tp),
    rmsDb: db(rms),
    lufs,
    lra,
    noiseFloorDb,
    plrDb: lufs === null ? null : db(tp) - lufs,
    clipping: clippedFraction(audio, peak),
    dcOffset: dc,
    silence: silent / totalFrames,
    balanceDb,
    correlation,
    bands,
  };
}

export type FindingStatus = "ok" | "warn" | "bad";
export type Finding = { id: string; status: FindingStatus; label: string; detail: string };

/** O que o áudio é muda o que é "problema": graves em baixo e bumbo são esperados. */
export type DiagnoseContext = { kind?: "speech" | "singing" | "drums" | "instrument" | "music"; instrument?: "baixo" | "violao" | "guitarra" | "teclado" | null };

const f = (id: string, status: FindingStatus, label: string, detail: string): Finding => ({ id, status, label, detail });

export function diagnose(m: Measurements, ctx: DiagnoseContext = {}): Finding[] {
  const out: Finding[] = [];

  if (m.clipping > 0.001) out.push(f("clipping", "bad", "Clipping (som estourado)", `${(m.clipping * 100).toFixed(2)}% das amostras no limite. Grave com menos volume na entrada se puder.`));
  else if (m.clipping > 0) out.push(f("clipping", "warn", "Clipping leve", `${(m.clipping * 100).toFixed(3)}% das amostras no limite.`));
  else out.push(f("clipping", "ok", "Sem clipping", `Pico em ${m.peakDb.toFixed(1)} dBFS.`));

  const speechLike = ctx.kind === "speech";
  if (speechLike) {
    const snr = m.noiseFloorDb;
    if (snr > -40) out.push(f("noise", "bad", "Ruído de fundo alto", `Fundo em ${snr.toFixed(0)} dBFS. A remoção de ruído ajuda.`));
    else if (snr > -50) out.push(f("noise", "warn", "Ruído moderado", `Fundo em ${snr.toFixed(0)} dBFS.`));
    else out.push(f("noise", "ok", "Fundo limpo", `Fundo em ${snr.toFixed(0)} dBFS.`));
  } else if (m.noiseFloorDb > -35 && ctx.kind !== "music" && ctx.kind !== "drums") {
    out.push(f("noise", "warn", "Fundo alto entre as partes", `Fundo em ${m.noiseFloorDb.toFixed(0)} dBFS.`));
  } else {
    out.push(f("noise", "ok", "Fundo sob controle", `Fundo em ${m.noiseFloorDb.toFixed(0)} dBFS.`));
  }

  if (m.lufs === null) out.push(f("level", "warn", "Volume não medido", "O trecho é curto demais ou silencioso."));
  else if (m.lufs < -26) out.push(f("level", "bad", "Volume muito baixo", `${m.lufs.toFixed(1)} LUFS. O Mix Pro sobe isso no final.`));
  else if (m.lufs < -20) out.push(f("level", "warn", "Volume baixo", `${m.lufs.toFixed(1)} LUFS.`));
  else if (m.lufs > -9) out.push(f("level", "warn", "Volume já muito alto", `${m.lufs.toFixed(1)} LUFS: sobra pouca margem para mixar.`));
  else out.push(f("level", "ok", "Volume adequado", `${m.lufs.toFixed(1)} LUFS.`));

  const lowShare = m.bands.sub + m.bands.low;
  const bassContent = ctx.kind === "drums" || ctx.instrument === "baixo";
  if (!bassContent && lowShare > 0.75) out.push(f("bass", "warn", "Graves em excesso", `${(lowShare * 100).toFixed(0)}% da energia abaixo de 250 Hz.`));
  else if (m.bands.sub > 0.2 && !bassContent) out.push(f("bass", "warn", "Muita energia abaixo de 60 Hz", "Vento, batida em mesa ou ar-condicionado. Um corte de graves ajuda."));
  else out.push(f("bass", "ok", "Graves equilibrados", `${(lowShare * 100).toFixed(0)}% da energia abaixo de 250 Hz.`));

  const topShare = m.bands.highMid + m.bands.high;
  if (topShare > 0.45) out.push(f("treble", "warn", "Agudos em excesso", `${(topShare * 100).toFixed(0)}% da energia acima de 2,5 kHz.`));
  else out.push(f("treble", "ok", "Agudos equilibrados", `${(topShare * 100).toFixed(0)}% da energia acima de 2,5 kHz.`));

  if (m.plrDb !== null) {
    if (m.plrDb < 8) out.push(f("dynamics", "warn", "Dinâmica muito comprimida", `Pico ${m.plrDb.toFixed(1)} dB acima da média: pouco espaço para respirar.`));
    else if (m.plrDb > 24) out.push(f("dynamics", "warn", "Dinâmica muito aberta", `Pico ${m.plrDb.toFixed(1)} dB acima da média: o compressor ajuda a deixar o volume uniforme.`));
    else out.push(f("dynamics", "ok", "Dinâmica saudável", `Pico ${m.plrDb.toFixed(1)} dB acima da média.`));
  }

  if (m.balanceDb !== null && m.correlation !== null) {
    if (Math.abs(m.balanceDb) > 3) out.push(f("stereo", "warn", "Estéreo desequilibrado", `${m.balanceDb > 0 ? "Esquerdo" : "Direito"} ${Math.abs(m.balanceDb).toFixed(1)} dB mais alto.`));
    else if (m.correlation < -0.2) out.push(f("stereo", "bad", "Fases opostas no estéreo", `Correlação ${m.correlation.toFixed(2)}: some som ao ouvir em mono.`));
    else out.push(f("stereo", "ok", "Estéreo balanceado", `Diferença de ${Math.abs(m.balanceDb).toFixed(1)} dB entre os lados.`));
  }

  if (m.dcOffset > 0.01) out.push(f("dc", "warn", "DC offset", `Componente contínua de ${(m.dcOffset * 100).toFixed(1)}%. Um filtro de graves resolve.`));

  if (m.silence > 0.4) out.push(f("silence", "warn", "Muito silêncio", `${(m.silence * 100).toFixed(0)}% do arquivo está abaixo de -60 dBFS.`));

  return out;
}
