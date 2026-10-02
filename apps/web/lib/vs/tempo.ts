/**
 * BPM e batidas da música, e o canal de clique.
 *
 * 1. Força dos ataques a cada 10 ms (subida de energia em 3 faixas: grave, médio, agudo).
 * 2. Andamento: autocorrelação dessa força, com preferência suave por ~120 BPM (evita achar o dobro
 *    ou a metade).
 * 3. Batidas: programação dinâmica (Ellis, 2007), que segue pequenas variações de quem toca ao vivo.
 * 4. Tempo 1 do compasso (4/4): a fase em que o grave (bumbo/baixo) mais bate.
 */
import { applySections, butterworth } from "@/lib/dsp/filters";

const FPS = 100;

export type Beats = { bpm: number; beats: number[]; downbeat: number };

function bandEnvelope(x: Float32Array, sr: number, sections: ReturnType<typeof butterworth>) {
  const y = x.slice();
  applySections(y, sections);
  const hop = Math.round(sr / FPS);
  const frames = Math.floor(y.length / hop);
  const e = new Float32Array(frames);
  for (let f = 0; f < frames; f++) {
    let s = 0;
    for (let i = f * hop; i < (f + 1) * hop; i++) s += y[i] * y[i];
    e[f] = Math.log10(s / hop + 1e-10);
  }
  // força do ataque: só a subida
  const o = new Float32Array(frames);
  for (let f = 1; f < frames; f++) o[f] = Math.max(0, e[f] - e[f - 1]);
  return o;
}

function normalize(o: Float32Array) {
  let m = 0;
  for (const v of o) m += v;
  m /= Math.max(1, o.length);
  let sd = 0;
  for (const v of o) sd += (v - m) ** 2;
  sd = Math.sqrt(sd / Math.max(1, o.length)) || 1;
  return o.map((v) => v / sd);
}

/** `mono` = música inteira (ou a bateria separada, que dá batidas mais limpas). */
export function trackBeats(mono: Float32Array, sr: number): Beats {
  const low = bandEnvelope(mono, sr, butterworth("lp", 2, 150, sr));
  const mid = bandEnvelope(mono, sr, [...butterworth("hp", 2, 150, sr), ...butterworth("lp", 2, 3000, sr)]);
  const high = bandEnvelope(mono, sr, butterworth("hp", 2, 3000, sr));
  const n = Math.min(low.length, mid.length, high.length);
  const onset = normalize(Float32Array.from({ length: n }, (_, i) => low[i] + mid[i] + high[i]));

  // andamento: autocorrelação de 50 a 220 BPM, pesada em torno de 120 BPM
  const minLag = Math.round((60 / 220) * FPS);
  const maxLag = Math.round((60 / 50) * FPS);
  const span = Math.min(n, FPS * 240); // até 4 min bastam para o andamento
  const acf = (lag: number) => {
    if (lag >= span) return 0;
    let ac = 0;
    for (let i = lag; i < span; i++) ac += onset[i] * onset[i - lag];
    return ac / (span - lag);
  };
  const ac = new Float32Array(4 * maxLag + 1);
  for (let lag = minLag; lag < ac.length; lag++) ac[lag] = acf(lag);
  let bestLag = 50;
  let best = -Infinity;
  for (let lag = minLag; lag <= maxLag; lag++) {
    // a batida se confirma no dobro e no quádruplo do intervalo (meio compasso, compasso);
    // síncopes não se repetem assim
    const harm = ac[lag] + 0.5 * ac[2 * lag] + 0.25 * ac[4 * lag];
    const bpm = (60 * FPS) / lag;
    const w = Math.exp(-0.5 * (Math.log2(bpm / 120) / 1.4) ** 2);
    const score = harm * w;
    if (score > best) [best, bestLag] = [score, lag];
  }
  // refina o período com a vizinhança (fração de quadro)
  const period = bestLag;

  // batidas: C(t) = O(t) + max[C(τ) − α·log²((t−τ)/P)]
  const alpha = 100; // "tightness" padrão do método: segue o andamento, não as síncopes
  const score = new Float32Array(n);
  const back = new Int32Array(n).fill(-1);
  for (let t = 0; t < n; t++) {
    let bestPrev = -Infinity;
    let arg = -1;
    for (let tau = t - Math.round(2 * period); tau <= t - Math.round(period / 2); tau++) {
      if (tau < 0) continue;
      const v = score[tau] - alpha * Math.log((t - tau) / period) ** 2;
      if (v > bestPrev) [bestPrev, arg] = [v, tau];
    }
    score[t] = onset[t] + (arg >= 0 ? bestPrev : 0);
    back[t] = arg;
  }
  // última batida: o melhor ponto do último período
  let t = n - 1;
  for (let i = Math.max(0, n - period); i < n; i++) if (score[i] > score[t]) t = i;
  const frames: number[] = [];
  while (t >= 0) {
    frames.push(t);
    t = back[t];
  }
  frames.reverse();
  // tira batidas no silêncio do começo e do fim (antes do primeiro e depois do último ataque forte)
  const strong = (f: number) => onset[f] > 0.5 || (f > 0 && onset[f - 1] > 0.5) || onset[f + 1] > 0.5;
  let a = 0;
  while (a < frames.length && !strong(frames[a])) a++;
  let z = frames.length - 1;
  while (z > a && !strong(frames[z])) z--;
  const kept = frames.slice(a, z + 1);

  // tempo 1: a fase (de 4) com mais grave nas batidas
  const lowN = normalize(low);
  let downbeat = 0;
  let bestLow = -Infinity;
  for (let ph = 0; ph < 4; ph++) {
    let s = 0;
    for (let i = ph; i < kept.length; i += 4) s += lowN[kept[i]] ?? 0;
    if (s > bestLow) [bestLow, downbeat] = [s, ph];
  }

  // BPM pela mediana dos intervalos (segue o que de fato foi tocado)
  const ints = kept.slice(1).map((f, i) => f - kept[i]).sort((x, y) => x - y);
  const med = ints.length ? ints[Math.floor(ints.length / 2)] : period;
  return { bpm: Math.round(((60 * FPS) / med) * 10) / 10, beats: kept.map((f) => f / FPS), downbeat };
}

/** Canal de clique (mono em 16 bits): bipe curto em cada batida, mais agudo no tempo 1. */
export function clickTrack(b: Beats, length: number, sr: number): Int16Array {
  const out = new Int16Array(length);
  const len = Math.round(sr * 0.035);
  b.beats.forEach((t, i) => {
    const accent = (i - b.downbeat) % 4 === 0;
    const f = accent ? 2000 : 1500;
    const amp = accent ? 0.7 : 0.5;
    const s0 = Math.round(t * sr);
    for (let k = 0; k < len && s0 + k < length; k++) {
      const env = Math.min(1, k / (sr * 0.001)) * Math.exp(-k / (sr * 0.008));
      out[s0 + k] = Math.round(32767 * amp * env * Math.sin((2 * Math.PI * f * k) / sr));
    }
  });
  return out;
}
