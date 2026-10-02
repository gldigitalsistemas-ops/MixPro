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
function onsets(e: Float32Array, hopSec: number, sens = 0): Onset[] {
  // sens (dB, de -9 a +9): positivo aceita ataques mais fracos; 0 = como sempre foi
  const minFlux = 6 - sens * 0.35;
  const margin = 4 - sens * 0.25;
  const floorGap = 12 - sens * 0.6;
  const k = 3;
  const flux = new Float32Array(e.length);
  // subida total em 9 ms (ataques que se espalham por 2 quadros também contam inteiros)
  for (let f = k; f < e.length; f++) flux[f] = Math.max(0, e[f] - e[f - k]);
  const floor = percentile(Array.from(e), 0.2);
  const win = Math.round(0.5 / hopSec);
  const minGap = Math.round(0.06 / hopSec);
  const out: Onset[] = [];
  for (let f = k; f < e.length - 1; f++) {
    if (flux[f] < minFlux || flux[f] < flux[f - 1] || flux[f] < flux[f + 1]) continue;
    // limiar local: média do fluxo na vizinhança + margem
    let s = 0;
    let c = 0;
    for (let j = Math.max(0, f - win); j < Math.min(e.length, f + win); j += 2) {
      s += flux[j];
      c++;
    }
    if (flux[f] < s / c + margin) continue;
    let peak = e[f];
    for (let j = f; j < Math.min(e.length, f + 10); j++) peak = Math.max(peak, e[j]);
    if (peak < floor + floorGap) continue;
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
type Metronome = { frames: Set<number>; period: number; level: number };

function metronomeClicks(cands: { frame: number; peak: number; alone: boolean }[], hopSec: number): Metronome {
  const out: Metronome = { frames: new Set<number>(), period: 0, level: 0 };
  // poucos cliques sobram fora das batidas (a maioria cai junto com bumbo e caixa): 4 bastam,
  // porque os outros critérios (curto, sem corpo, força constante, grade exata) são rígidos
  if (cands.length < 4) return out;
  // nível do clique: o volume com mais candidatos em ±2,5 dB (bumbos fracos também entram como
  // candidatos e puxavam a mediana para baixo)
  let med = cands[0].peak;
  let best = 0;
  for (const c of cands) {
    const k = cands.filter((d) => Math.abs(d.peak - c.peak) <= 2.5).length;
    if (k > best) [best, med] = [k, c.peak];
  }
  const steady = cands.filter((c) => Math.abs(c.peak - med) <= 2.5);
  if (steady.length / cands.length < 0.4 || steady.length < 4) return out;
  // precisa haver cliques sem bumbo junto (contagem, tempos sem bumbo): bumbo regular não é metrônomo
  if (steady.filter((c) => c.alone).length < Math.min(4, Math.ceil(steady.length / 3))) return out;
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
  // cliques: os regulares e o acento (até 8 dB acima)
  for (const c of cands) if (c.peak >= med - 2.5 && c.peak <= med + 8) out.frames.add(c.frame);
  out.period = period;
  out.level = med;
  return out;
}

/**
 * Planura do espectro (0–1) logo no ataque, de 500 Hz a 10 kHz: o clique do metrônomo é tonal
 * (a energia fica em poucas frequências, ~0,05–0,15); caixa, prato e estalo de baqueta são ruído
 * (~0,3 ou mais), inclusive quando a caixa bate junto com o clique.
 */
function makeFlatness(x: Float32Array, sr: number) {
  const N = 1024;
  const k0 = Math.max(1, Math.round((500 * N) / sr));
  const k1 = Math.min(N / 2 - 1, Math.round((10000 * N) / sr));
  const cos = new Float32Array(N);
  const sin = new Float32Array(N);
  const win = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    cos[i] = Math.cos((2 * Math.PI * i) / N);
    sin[i] = Math.sin((2 * Math.PI * i) / N);
    win[i] = 0.5 - 0.5 * cos[i];
  }
  const frame = new Float32Array(N);
  return (start: number): number => {
    if (start < 0 || start + N > x.length) return 1;
    for (let i = 0; i < N; i++) frame[i] = x[start + i] * win[i];
    let logSum = 0;
    let sum = 0;
    for (let k = k0; k <= k1; k++) {
      let re = 0;
      let im = 0;
      for (let i = 0, idx = 0; i < N; i++, idx = (idx + k) & (N - 1)) {
        re += frame[i] * cos[idx];
        im -= frame[i] * sin[idx];
      }
      const p = re * re + im * im + 1e-20;
      logSum += Math.log(p);
      sum += p;
    }
    const bins = k1 - k0 + 1;
    return Math.exp(logSum / bins) / (sum / bins);
  };
}
const TONAL = 0.2;

/** Posição exata do ataque: primeira amostra acima de 30% do pico local no sinal da banda. */
function refine(x: Float32Array, center: number, sr: number): number {
  const from = Math.max(0, center - Math.round(sr * 0.012));
  const to = Math.min(x.length, center + Math.round(sr * 0.02));
  let peak = 0;
  for (let i = from; i < to; i++) peak = Math.max(peak, Math.abs(x[i]));
  for (let i = from; i < to; i++) if (Math.abs(x[i]) >= peak * 0.3) return i;
  return center;
}

/**
 * Sensibilidade de cada peça (0–100). 50 = automático: o limiar já é calculado pelo volume do próprio
 * arquivo. Acima de 50 pega batidas mais fracas (ghost notes); abaixo, ignora vazamento e sala.
 * Cada ponto de 50 equivale a 9 dB no limiar.
 */
export type DrumSensitivity = { kick: number; snare: number; tom: number };
export const AUTO_SENSITIVITY: DrumSensitivity = { kick: 50, snare: 50, tom: 50 };
const sensDb = (v: number | undefined) => ((Math.min(100, Math.max(0, v ?? 50)) - 50) / 50) * 9;

export function detectDrums(
  audio: Signal,
  sr: number,
  sensitivity: DrumSensitivity = AUTO_SENSITIVITY,
): { hits: Hit[]; counts: Record<Piece, number>; metronome: boolean } {
  const sKick = sensDb(sensitivity.kick);
  const sSnare = sensDb(sensitivity.snare);
  const sTom = sensDb(sensitivity.tom);
  // cada fader também mexe nos ataques da faixa da sua peça
  const bandSens: Record<string, number> = { low: sKick, wires: sSnare, body: sTom };
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
    ons[band] = onsets(env[band], hopSec, bandSens[band] ?? 0);
  }
  const peakAt = (band: Band, f: number) => {
    let p = -120;
    for (let j = f; j < Math.min(env[band].length, f + 10); j++) p = Math.max(p, env[band][j]);
    return p;
  };

  const tol = Math.round(0.025 / hopSec);
  const kickRef = percentile(ons.low.map((o) => o.peak), 0.9);
  let snareRef = percentile(ons.wires.map((o) => o.peak), 0.9);
  // referência com tudo (inclusive o clique): régua para "caixa junto com o bumbo" quando há metrônomo
  const snareRefAll = snareRef;
  let bodyRef = percentile(ons.body.map((o) => o.peak), 0.9);
  let airRef = percentile(ons.air.map((o) => o.peak), 0.9);
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
  // clique de verdade (fone vazando, caixinha na sala) ressoa e às vezes tem um tom grave que cai na
  // faixa do corpo: o que denuncia é ser tonal. Caixa batida junto com o clique vira ruído e não entra.
  const flatness = makeFlatness(m, sr);
  const flat = new Map<number, number>();
  const flatAt = (f: number) => {
    if (!flat.has(f)) flat.set(f, flatness(Math.max(0, f * hop - Math.round(sr * 0.003))));
    return flat.get(f)!;
  };
  const clickCands = ons.wires
    .filter((w) => (!bodyStrongAt(w.frame) && !near(strongLow, w.frame, tol) && shortDecay(w.frame)) || flatAt(w.frame) < TONAL)
    .map((w) => ({ frame: w.frame, peak: w.peak, alone: !near(strongLow, w.frame, tol) }));
  const metro = metronomeClicks(clickCands, hopSec);
  const clicks = metro.frames;
  // com o metrônomo reconhecido, todo ataque no volume do clique e na grade de tempo é clique, mesmo
  // quando o chimbal bate junto e tira a "tonalidade" dele
  if (clicks.size) {
    const known = [...clicks].sort((a, b) => a - b);
    for (const w of ons.wires) {
      if (clicks.has(w.frame) || w.peak < metro.level - 2.5 || w.peak > metro.level + 8) continue;
      let nearest = known[0];
      for (const c of known) if (Math.abs(c - w.frame) < Math.abs(nearest - w.frame)) nearest = c;
      const r = (Math.abs(w.frame - nearest) * hopSec) / metro.period;
      if (Math.round(r) <= 8 && Math.abs(r - Math.round(r)) <= 0.06) clicks.add(w.frame);
    }
  }
  const isClick = (f: number) => [...clicks].some((c) => Math.abs(c - f) <= tol);
  if (clicks.size) {
    // o clique costuma ser mais alto que a bateria: as referências de volume passam a ignorá-lo
    // (senão a caixa de verdade parecia fraca demais e era descartada)
    const free = (list: Onset[]) => list.filter((o) => !isClick(o.frame) || flatAt(o.frame) >= TONAL).map((o) => o.peak);
    snareRef = percentile(free(ons.wires), 0.9);
    bodyRef = percentile(free(ons.body), 0.9);
    airRef = percentile(free(ons.air), 0.9);
  }
  // Tambor por baixo do clique: a caixa no 2 e no 4 cai junto com o clique e fica ~20 dB abaixo dele,
  // mas o corpo (150–400 Hz) sobe muito acima do clique sozinho. Nível do clique sozinho = quartil
  // inferior (os tempos sem tambor), comparado em cada clique.
  const clickFrames = [...clicks];
  const clickBody = percentile(clickFrames.map((f) => peakAt("body", f)), 0.25);
  const clickAir = percentile(clickFrames.map((f) => peakAt("air", f)), 0.25);
  const drumUnder = (f: number) => peakAt("body", f) >= clickBody + 12 - sSnare;
  // Com metrônomo, as caixas reais costumam bater junto com o clique (2 e 4): o corpo delas vira a
  // régua para as batidas fora do clique (notas fantasmas, chimbal e pedal ficam bem abaixo)
  const underClick = clickFrames.filter((f) => drumUnder(f) && !near(strongLow, f, tol)).map((f) => peakAt("body", f));
  const snareBodyRef = underClick.length >= 3 ? percentile(underClick, 0.5) : null;
  // clique sem tambor por baixo: não é bumbo, caixa, tom nem surdo
  const clickOnly = (f: number) => clicks.size > 0 && isClick(f) && !drumUnder(f);

  // Caixa: a esteira (1,8–6,5 kHz) sobe junto com o corpo, e mais forte que o brilho dos pratos
  for (const w of ons.wires) {
    if (w.peak < snareRef - 15 - sSnare) continue;
    // o corpo (150–400 Hz) sobe junto com a esteira; no chimbal/prato ele não sobe
    const bodyStrong = bodyStrongAt(w.frame);
    // com metrônomo: ataque curtíssimo na faixa da esteira é clique, mesmo junto com o bumbo (o corpo
    // é do bumbo). Caixa de verdade ressoa (não é curta) e passa, inclusive batida junto com o clique.
    const withKickHere = near(strongLow, w.frame, tol);
    if (clicks.size && isClick(w.frame)) {
      // no clique: só conta se há tambor por baixo e não é o bumbo (o laço do bumbo cuida dele);
      // a esteira acrescenta chiado acima do clique sozinho, o tom não
      if (!drumUnder(w.frame) || withKickHere) continue;
      if (peakAt("air", w.frame) < clickAir + 0.5) continue;
      snareFrames.push(w.frame);
      hits.push({ piece: "snare", sample: refine(sig.body, w.frame * hop, sr), velocity: vel(peakAt("body", w.frame), bodyRef) });
      continue;
    }
    const air = near(ons.air, w.frame, tol);
    const wiresOnly = !air || w.peak - air.peak > 3;
    const withKick = near(strongLow, w.frame, tol);
    // com metrônomo, a referência sem o clique fica baixa (a caixa de verdade bate junto com o clique)
    // e o estalo do pedal do bumbo passaria por caixa: junto do bumbo, só caixa forte de verdade
    if (withKick && w.peak < (clicks.size ? snareRefAll : snareRef) - 3) continue;
    if (snareBodyRef !== null && peakAt("body", w.frame) < snareBodyRef - 12 - sSnare) continue;
    if (bodyStrong || (wiresOnly && w.peak >= snareRef - 6 - sSnare)) {
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
    // surdo e tons graves passam pelo limiar dos tons; o bumbo, pelo do bumbo
    const lowTom = subRatio(l.frame) < typicalRatio - 6;
    if (l.peak < kickRef - 14 - (lowTom ? sTom : sKick)) continue;
    const body = near(ons.body, l.frame, tol);
    if (isSnare(l.frame) && l.peak < kickRef - 5) continue;
    if (lowTom) {
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
    if (clickOnly(b.frame)) continue;
    if (b.peak < bodyRef - 10 - sTom || isSnare(b.frame) || kickFrames.some((k) => Math.abs(k - b.frame) <= tol)) continue;
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
