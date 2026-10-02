/**
 * Detecção das peças da bateria numa gravação estéreo/mono (celular):
 * bandas de frequência → energia em quadros de 3 ms → ataques (fluxo de energia) →
 * classificação por onde a energia sobe junto (bumbo, caixa, tons, pratos).
 */
import { applySections, butterworth } from "../filters";
import type { Signal } from "../types";

export type Piece = "kick" | "snare" | "tom" | "cymbal";
export type Hit = { piece: Piece; sample: number; velocity: number };

type Onset = { frame: number; rise: number; peak: number };

const BANDS = {
  sub: (sr: number) => butterworth("lp", 4, 75, sr),
  low: (sr: number) => butterworth("lp", 4, 150, sr),
  body: (sr: number) => [...butterworth("hp", 2, 150, sr), ...butterworth("lp", 2, 400, sr)],
  wires: (sr: number) => [...butterworth("hp", 2, 1800, sr), ...butterworth("lp", 2, 6500, sr)],
  air: (sr: number) => butterworth("hp", 4, 7000, sr),
};
type Band = keyof typeof BANDS;

function mono(audio: Signal): Float32Array<ArrayBuffer> {
  const n = audio[0].length;
  const m = new Float32Array(n);
  for (const ch of audio) for (let i = 0; i < n; i++) m[i] += ch[i] / audio.length;
  return m;
}

/**
 * Energia (dB) em quadros de `hop` amostras. A janela precisa cobrir ao menos um ciclo da banda
 * (um bumbo de 48 Hz dura 21 ms por ciclo): janela curta em grave "ondula" e gera ataques falsos.
 */
function energy(x: Float32Array, hop: number, windowFrames: number): Float32Array {
  const frames = Math.floor(x.length / hop);
  const e = new Float32Array(frames);
  for (let f = 0; f < frames; f++) {
    // janela centrada no quadro, para o instante do ataque não adiantar
    const start = Math.max(0, (f - Math.floor(windowFrames / 2)) * hop);
    const end = Math.min(x.length, (f + Math.ceil(windowFrames / 2) + 1) * hop);
    let s = 0;
    for (let i = start; i < end; i++) s += x[i] * x[i];
    e[f] = 10 * Math.log10(s / (end - start) + 1e-12);
  }
  return e;
}

/** Janela de energia por banda, em quadros de 3 ms. */
const WINDOW: Record<string, number> = { sub: 8, low: 8, body: 4, wires: 2, air: 2 };

function percentile(values: number[], p: number): number {
  if (!values.length) return -120;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))];
}

/** Ataques: subida de energia em 9 ms acima de um limiar adaptativo, no máximo um a cada 60 ms. */
function onsets(e: Float32Array, hopSec: number): Onset[] {
  const k = 3;
  const flux = new Float32Array(e.length);
  // subida total em 9 ms (ataques que se espalham por 2 quadros também contam inteiros)
  for (let f = k; f < e.length; f++) flux[f] = Math.max(0, e[f] - e[f - k]);
  const floor = percentile(Array.from(e), 0.2);
  const win = Math.round(0.5 / hopSec);
  const minGap = Math.round(0.06 / hopSec);
  const out: Onset[] = [];
  for (let f = k; f < e.length - 1; f++) {
    if (flux[f] < 6 || flux[f] < flux[f - 1] || flux[f] < flux[f + 1]) continue;
    // limiar local: média do fluxo na vizinhança + margem
    let s = 0;
    let c = 0;
    for (let j = Math.max(0, f - win); j < Math.min(e.length, f + win); j += 2) {
      s += flux[j];
      c++;
    }
    if (flux[f] < s / c + 4) continue;
    let peak = e[f];
    for (let j = f; j < Math.min(e.length, f + 10); j++) peak = Math.max(peak, e[j]);
    if (peak < floor + 12) continue;
    const last = out[out.length - 1];
    if (last && f - last.frame < minGap) {
      if (flux[f] > last.rise) out[out.length - 1] = { frame: f, rise: flux[f], peak };
      continue;
    }
    out.push({ frame: f, rise: flux[f], peak });
  }
  return out;
}

const near = (list: Onset[], frame: number, tol: number) => list.find((o) => Math.abs(o.frame - frame) <= tol);

/**
 * Metrônomo (clique no fone vazando ou na caixinha de som): cai na faixa da esteira da caixa, mas
 * - some muito rápido (em ~40 ms já caiu 15 dB; a caixa ressoa),
 * - não tem corpo (150–400 Hz não sobe junto),
 * - vem sempre com a mesma força (o baterista nunca bate igual) — o acento do 1 é tolerado,
 * - cai numa grade de tempo exata.
 * Devolve os quadros dos cliques (vazio se não houver metrônomo).
 */
function metronomeClicks(cands: { frame: number; peak: number }[], hopSec: number): Set<number> {
  const out = new Set<number>();
  // poucos cliques sobram fora das batidas (a maioria cai junto com bumbo e caixa): 4 bastam,
  // porque os outros critérios (curto, sem corpo, força constante, grade exata) são rígidos
  if (cands.length < 4) return out;
  const peaks = cands.map((c) => c.peak).sort((a, b) => a - b);
  const med = peaks[Math.floor(peaks.length / 2)];
  const steady = cands.filter((c) => Math.abs(c.peak - med) <= 2.5);
  if (steady.length / cands.length < 0.6 || steady.length < 4) return out;
  // grade: intervalos (0,25–2 s) que são múltiplos do intervalo mais curto e comum
  const iois: number[] = [];
  for (let i = 1; i < steady.length; i++) iois.push((steady[i].frame - steady[i - 1].frame) * hopSec);
  const plausible = iois.filter((v) => v >= 0.25 && v <= 2).sort((a, b) => a - b);
  if (plausible.length < 3) return out;
  const period = plausible[Math.floor(plausible.length * 0.25)];
  const onGrid = iois.filter((v) => {
    const r = v / period;
    return Math.round(r) >= 1 && Math.abs(r - Math.round(r)) <= 0.06;
  }).length;
  if (onGrid / iois.length < 0.75) return out;
  // cliques: os regulares e o acento (até 8 dB acima), todos curtos e sem corpo
  for (const c of cands) if (c.peak >= med - 2.5 && c.peak <= med + 8) out.add(c.frame);
  return out;
}

/** Posição exata do ataque: primeira amostra acima de 30% do pico local no sinal da banda. */
function refine(x: Float32Array, center: number, sr: number): number {
  const from = Math.max(0, center - Math.round(sr * 0.012));
  const to = Math.min(x.length, center + Math.round(sr * 0.02));
  let peak = 0;
  for (let i = from; i < to; i++) peak = Math.max(peak, Math.abs(x[i]));
  for (let i = from; i < to; i++) if (Math.abs(x[i]) >= peak * 0.3) return i;
  return center;
}

export function detectDrums(audio: Signal, sr: number): { hits: Hit[]; counts: Record<Piece, number>; metronome: boolean } {
  const m = mono(audio);
  const hop = Math.max(1, Math.round(sr * 0.003));
  const hopSec = hop / sr;
  const sig = {} as Record<Band, Float32Array>;
  const env = {} as Record<Band, Float32Array>;
  const ons = {} as Record<Band, Onset[]>;
  for (const band of Object.keys(BANDS) as Band[]) {
    const x = m.slice();
    applySections(x, BANDS[band](sr));
    sig[band] = x;
    env[band] = energy(x, hop, WINDOW[band]);
    ons[band] = onsets(env[band], hopSec);
  }
  const peakAt = (band: Band, f: number) => {
    let p = -120;
    for (let j = f; j < Math.min(env[band].length, f + 10); j++) p = Math.max(p, env[band][j]);
    return p;
  };

  const tol = Math.round(0.025 / hopSec);
  const kickRef = percentile(ons.low.map((o) => o.peak), 0.9);
  const snareRef = percentile(ons.wires.map((o) => o.peak), 0.9);
  const bodyRef = percentile(ons.body.map((o) => o.peak), 0.9);
  const airRef = percentile(ons.air.map((o) => o.peak), 0.9);
  const vel = (peak: number, ref: number) => Math.min(1.4, Math.max(0.06, 10 ** ((peak - ref) / 20)));

  const hits: Hit[] = [];
  const snareFrames: number[] = [];
  // grave forte no mesmo instante = bumbo (o corpo que sobe é do bumbo, não de uma caixa)
  const strongLow = ons.low.filter((o) => o.peak >= kickRef - 8);

  // corpo subindo junto com um ataque (caixa e tons têm; metrônomo e chimbal não)
  const bodyRiseAt = (f: number) => env.body[f] - Math.min(env.body[Math.max(0, f - 4)], env.body[Math.max(0, f - 8)]);
  const bodyStrongAt = (f: number) => peakAt("body", f) >= bodyRef - 12 && bodyRiseAt(f) >= 5;

  // Metrônomo: ataques curtos e sem corpo na faixa da esteira, mesma força, em grade exata
  const decayFrames = Math.round(0.04 / hopSec);
  const shortDecay = (f: number) => f + decayFrames < env.wires.length && peakAt("wires", f) - env.wires[f + decayFrames] >= 15;
  const clickCands = ons.wires
    .filter((w) => !bodyStrongAt(w.frame) && !near(strongLow, w.frame, tol) && shortDecay(w.frame))
    .map((w) => ({ frame: w.frame, peak: w.peak }));
  const clicks = metronomeClicks(clickCands, hopSec);
  const isClick = (f: number) => [...clicks].some((c) => Math.abs(c - f) <= tol);

  // Caixa: a esteira (1,8–6,5 kHz) sobe junto com o corpo, e mais forte que o brilho dos pratos
  for (const w of ons.wires) {
    if (w.peak < snareRef - 15) continue;
    // o corpo (150–400 Hz) sobe junto com a esteira; no chimbal/prato ele não sobe
    const bodyStrong = bodyStrongAt(w.frame);
    // com metrônomo: ataque curtíssimo na faixa da esteira é clique, mesmo junto com o bumbo (o corpo
    // é do bumbo). Caixa de verdade ressoa (não é curta) e passa, inclusive batida junto com o clique.
    const withKickHere = near(strongLow, w.frame, tol);
    if (clicks.size && shortDecay(w.frame) && (!bodyStrong || withKickHere)) continue;
    const air = near(ons.air, w.frame, tol);
    const wiresOnly = !air || w.peak - air.peak > 3;
    const withKick = near(strongLow, w.frame, tol);
    if (withKick && w.peak < snareRef - 3) continue;
    if (bodyStrong || (wiresOnly && w.peak >= snareRef - 6)) {
      snareFrames.push(w.frame);
      hits.push({ piece: "snare", sample: refine(sig.wires, w.frame * hop, sr), velocity: vel(w.peak, snareRef) });
    }
  }
  const isSnare = (f: number) => snareFrames.some((s) => Math.abs(s - f) <= tol);

  // Bumbo x surdo: o bumbo concentra energia abaixo de ~75 Hz; comparado ao padrão do próprio
  // arquivo (celulares cortam grave de jeitos diferentes)
  const subRatio = (f: number) => peakAt("sub", f) - peakAt("low", f);
  const typicalRatio = percentile(ons.low.map((o) => subRatio(o.frame)), 0.5);
  const lowToms: Onset[] = [];
  for (const l of ons.low) {
    if (l.peak < kickRef - 14) continue;
    const body = near(ons.body, l.frame, tol);
    if (isSnare(l.frame) && l.peak < kickRef - 5) continue;
    if (subRatio(l.frame) < typicalRatio - 6) {
      lowToms.push(l);
      continue;
    }
    if (body && body.peak - l.peak > 3) continue;
    hits.push({ piece: "kick", sample: refine(sig.low, l.frame * hop, sr), velocity: vel(l.peak, kickRef) });
  }
  const kickFrames = hits.filter((h) => h.piece === "kick").map((h) => Math.round(h.sample / hop));

  // tom de verdade tem o estalo da baqueta (agudos); sem ele é só o batimento de tons soando juntos
  const stick = (f: number) => Boolean((near(ons.wires, f, tol) && !isClick(f)) || near(ons.air, f, tol));
  for (const t of lowToms) {
    if (!stick(t.frame)) continue;
    hits.push({ piece: "tom", sample: refine(sig.low, t.frame * hop, sr), velocity: vel(t.peak, kickRef) });
  }
  const tomFrames = lowToms.map((t) => t.frame);

  // Tons: corpo (150–400 Hz) sem esteira e sem bumbo no mesmo instante
  for (const b of ons.body) {
    if (tomFrames.some((f) => Math.abs(f - b.frame) <= tol)) continue;
    if (b.peak < bodyRef - 10 || isSnare(b.frame) || kickFrames.some((k) => Math.abs(k - b.frame) <= tol)) continue;
    const wires = near(ons.wires, b.frame, tol);
    if (wires && wires.peak > snareRef - 10) continue;
    if (!stick(b.frame)) continue;
    hits.push({ piece: "tom", sample: refine(sig.body, b.frame * hop, sr), velocity: vel(b.peak, bodyRef) });
  }

  // Pratos/chimbal: brilho (>7 kHz) sem caixa; junto com bumbo/tom só se o brilho for forte
  // (o clique da baqueta no bumbo e no tom também tem agudos)
  const drumFrames = hits.filter((h) => h.piece === "kick" || h.piece === "tom").map((h) => Math.round(h.sample / hop));
  for (const a of ons.air) {
    if (a.peak < airRef - 18 || isSnare(a.frame) || isClick(a.frame)) continue;
    if (drumFrames.some((f) => Math.abs(f - a.frame) <= tol) && a.peak < airRef - 6) continue;
    hits.push({ piece: "cymbal", sample: a.frame * hop, velocity: vel(a.peak, airRef) });
  }

  hits.sort((a, b) => a.sample - b.sample);
  const counts = { kick: 0, snare: 0, tom: 0, cymbal: 0 } as Record<Piece, number>;
  for (const h of hits) counts[h.piece]++;
  return { hits, counts, metronome: clicks.size > 0 };
}
