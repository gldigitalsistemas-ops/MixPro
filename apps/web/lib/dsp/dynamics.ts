/** Dinâmica: compressor feed-forward (Giannoulis et al., JAES 2012), limiter com lookahead e gate. */
import { coef, dbToGain, type Signal } from "./types";

function linkedLevel(audio: Signal, i: number): number {
  let lvl = 0;
  for (const ch of audio) {
    const v = Math.abs(ch[i]);
    if (v > lvl) lvl = v;
  }
  return lvl;
}

export function compressor(
  audio: Signal,
  sr: number,
  p: { threshold_db: number; ratio: number; attack_ms: number; release_ms: number; knee_db: number; makeup_db: number },
): Signal {
  const ratio = Math.max(p.ratio, 1);
  if (ratio <= 1.0001 && Math.abs(p.makeup_db) < 1e-3) return audio;
  const thr = p.threshold_db;
  const knee = p.knee_db;
  const aAtt = coef(p.attack_ms, sr);
  const aRel = coef(p.release_ms, sr);
  const slope = 1 / ratio - 1;
  const n = audio[0].length;
  let gs = 0;
  for (let i = 0; i < n; i++) {
    const lvl = linkedLevel(audio, i);
    const xdb = 20 * Math.log10(lvl > 1e-9 ? lvl : 1e-9);
    const over = xdb - thr;
    let gc: number;
    if (knee > 0 && 2 * Math.abs(over) <= knee) gc = (slope * (over + knee / 2) ** 2) / (2 * knee);
    else if (over > 0) gc = slope * over;
    else gc = 0;
    gs = gc < gs ? aAtt * gs + (1 - aAtt) * gc : aRel * gs + (1 - aRel) * gc;
    const g = 10 ** ((gs + p.makeup_db) / 20);
    for (const ch of audio) ch[i] *= g;
  }
  return audio;
}

/**
 * Limiter com lookahead: ganho requerido → mínimo na janela [i-la, i] → release → média móvel de la+1.
 * O ganho da amostra k usa a janela até k+la, então o sinal não é atrasado e não há overshoot.
 */
export function limiter(
  audio: Signal,
  sr: number,
  p: { ceiling_db: number; input_gain_db: number; release_ms: number; lookahead_ms: number },
): Signal {
  const ceiling = dbToGain(p.ceiling_db);
  const inGain = dbToGain(p.input_gain_db);
  const n = audio[0].length;
  const la = Math.max(1, Math.round(p.lookahead_ms * 1e-3 * sr));
  const total = n + la;
  const aRel = coef(p.release_ms, sr);

  const h = new Float64Array(total);
  for (let i = 0; i < n; i++) {
    const peak = linkedLevel(audio, i) * inGain;
    h[i] = Math.min(1, ceiling / Math.max(peak, 1e-12));
  }
  for (let i = n; i < total; i++) h[i] = 1;

  // mínimo em janela deslizante (deque monotônico)
  const minWin = new Float64Array(total);
  const dq = new Int32Array(total);
  let head = 0;
  let tail = 0;
  for (let i = 0; i < total; i++) {
    while (tail > head && h[dq[tail - 1]] >= h[i]) tail--;
    dq[tail++] = i;
    if (dq[head] < i - la) head++;
    minWin[i] = h[dq[head]];
  }
  let s = 1;
  for (let i = 0; i < total; i++) {
    const v = minWin[i];
    s = v < s ? v : aRel * s + (1 - aRel) * v;
    minWin[i] = s;
  }

  // y[k] = x[k] * média(minWin[k .. k+la])
  let acc = 0;
  for (let j = 0; j <= la; j++) acc += minWin[j];
  const w = la + 1;
  for (let k = 0; k < n; k++) {
    const g = (acc / w) * inGain;
    for (const ch of audio) {
      const y = ch[k] * g;
      ch[k] = y > ceiling ? ceiling : y < -ceiling ? -ceiling : y;
    }
    acc += (k + w < total ? minWin[k + w] : 1) - minWin[k];
  }
  return audio;
}

export function gate(
  audio: Signal,
  sr: number,
  p: { threshold_db: number; range_db: number; ratio: number; attack_ms: number; hold_ms: number; release_ms: number },
): Signal {
  if (p.range_db <= 0.01) return audio;
  const thr = p.threshold_db;
  const ratio = Math.max(p.ratio, 1);
  const aAtt = coef(p.attack_ms, sr);
  const aRel = coef(p.release_ms, sr);
  const aEnv = coef(10, sr);
  const hold = Math.floor(p.hold_ms * 1e-3 * sr);
  const n = audio[0].length;
  let env = 0;
  let g = 0;
  let holdLeft = 0;
  for (let i = 0; i < n; i++) {
    const lvl = linkedLevel(audio, i);
    env = lvl > env ? lvl : aEnv * env + (1 - aEnv) * lvl;
    const edb = 20 * Math.log10(env > 1e-9 ? env : 1e-9);
    let target: number;
    if (edb >= thr) {
      target = 0;
      holdLeft = hold;
    } else if (holdLeft > 0) {
      holdLeft--;
      target = 0;
    } else {
      target = Math.max((edb - thr) * (ratio - 1), -p.range_db);
    }
    g = target > g ? aAtt * g + (1 - aAtt) * target : aRel * g + (1 - aRel) * target;
    const gl = 10 ** (g / 20);
    for (const ch of audio) ch[i] *= gl;
  }
  return audio;
}
