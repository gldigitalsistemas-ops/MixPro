/**
 * BPM e batidas da música, e o canal de clique.
 *
 * 1. Força dos ataques a cada 10 ms (subida de energia em 3 faixas: grave, médio, agudo).
 * 2. Andamento: autocorrelação por faixa (grave, médio, agudo), com período fracionário, confirmada no
 *    meio compasso e no compasso (o falso pulso dos ritmos sincopados não se repete no compasso) e
 *    preferência suave por ~120 BPM (evita achar o dobro ou a metade).
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

  // andamento: autocorrelação de 50 a 220 BPM, POR FAIXA (grave, médio, agudo) e com período fracionário.
  // Ritmos sincopados (grupos de 3 semicolcheias, comuns no worship) imitam um pulso 4/3 mais rápido:
  // o chimbal em semicolcheias se repete a qualquer múltiplo da semicolcheia. O que o falso pulso não
  // imita é o compasso: bumbo e caixa se repetem a cada 4 tempos. Por isso o compasso pesa o dobro do
  // meio compasso, medido só no grave e no médio.
  const minLag = (60 / 220) * FPS;
  const maxLag = (60 / 50) * FPS;
  const span = Math.min(n, FPS * 240); // até 4 min bastam para o andamento
  const lowN = normalize(low.subarray(0, n));
  const midN = normalize(mid.subarray(0, n));
  const highN = normalize(high.subarray(0, n));
  const maxInt = Math.ceil(4 * maxLag) + 2;
  const table = (o: Float32Array) => {
    const ac = new Float32Array(maxInt + 1);
    for (let lag = 1; lag <= maxInt && lag < span; lag++) {
      let s = 0;
      for (let i = lag; i < span; i++) s += o[i] * o[i - lag];
      ac[lag] = s / (span - lag);
    }
    return ac;
  };
  const tl = table(lowN);
  const tm = table(midN);
  const th = table(highN);
  // autocorrelação num atraso fracionário (interpolação linear)
  const at = (ac: Float32Array, lag: number) => {
    const i = Math.floor(lag);
    const f = lag - i;
    return (ac[i] ?? 0) * (1 - f) + (ac[i + 1] ?? 0) * f;
  };
  let period = 50;
  let best = -Infinity;
  for (let lag = Math.ceil(minLag * 4) / 4; lag <= maxLag; lag += 0.25) {
    const beat = (at(tl, lag) + at(tm, lag) + at(th, lag)) / 3;
    const half = (at(tl, 2 * lag) + at(tm, 2 * lag) + at(th, 2 * lag)) / 3;
    const bar = (at(tl, 4 * lag) + at(tm, 4 * lag)) / 2;
    const bpm = (60 * FPS) / lag;
    // preferência suave por ~120 BPM (desempata dobro e metade)
    const w = Math.exp(-0.5 * (Math.log2(bpm / 120) / 1.4) ** 2);
    // o compasso pesa o dobro do meio compasso: é a repetição que o falso pulso 4/3 não consegue imitar
    const score = (beat + 0.5 * half + bar) * w;
    if (score > best) [best, period] = [score, lag];
  }

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
  for (let i = Math.max(0, n - Math.round(period)); i < n; i++) if (score[i] > score[t]) t = i;
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
  let kept = frames.slice(a, z + 1);

  // na batida ou no contratempo? Quem toca marca o tempo pelo bumbo e pela caixa (o "2 e 4"); o chimbal
  // soa igual nas duas fases e engana a busca acima. Se bumbo e caixa caem mais no meio das batidas,
  // as batidas vão para o meio (meio tempo para frente).
  if (kept.length > 8) {
    const kickSnare = (f: number) => {
      let v = 0;
      // a caixa (médio) pesa o dobro: o "2 e 4" é a referência de quem toca; o bumbo também cai em contratempos
      for (let d = -1; d <= 1; d++) v = Math.max(v, (lowN[f + d] ?? 0) + 2 * (midN[f + d] ?? 0));
      return v;
    };
    let on = 0;
    let off = 0;
    for (let i = 0; i + 1 < kept.length; i++) {
      on += kickSnare(kept[i]);
      off += kickSnare(Math.round((kept[i] + kept[i + 1]) / 2));
    }
    if (off > on * 1.15) kept = kept.slice(0, -1).map((f, i) => Math.round((f + kept[i + 1]) / 2));
  }

  // tempo 1: a fase (de 4) com mais grave nas batidas
  let downbeat = 0;
  let bestLow = -Infinity;
  for (let ph = 0; ph < 4; ph++) {
    let s = 0;
    for (let i = ph; i < kept.length; i += 4) s += lowN[kept[i]] ?? 0;
    if (s > bestLow) [bestLow, downbeat] = [s, ph];
  }

  // BPM pela mediana dos intervalos (segue o que de fato foi tocado)
  // (média dos intervalos típicos: a mediana em quadros inteiros de 10 ms erra até 1 BPM)
  const ints = kept.slice(1).map((f, i) => f - kept[i]).sort((x, y) => x - y);
  const mid0 = ints.length ? ints[Math.floor(ints.length / 2)] : period;
  const typical = ints.filter((v) => Math.abs(v / mid0 - 1) < 0.1);
  const med = typical.length ? typical.reduce((a, v) => a + v, 0) / typical.length : period;
  // BPM inteiro (o clique segue as batidas medidas; o número mostrado é sempre inteiro)
  return { bpm: Math.round((60 * FPS) / med), beats: kept.map((f) => f / FPS), downbeat };
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
