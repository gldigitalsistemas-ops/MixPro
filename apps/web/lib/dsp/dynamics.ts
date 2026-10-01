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
  const w = la + 1;

  // Em fluxo: só a janela de lookahead fica na memória (antes eram 3 buffers do tamanho do áudio,
  // ~575 MB num áudio estéreo de 10 min, o que derrubava o navegador do celular).
  const cap = w + 1;
  const dqIdx = new Int32Array(cap); // deque monotônico: mínimo na janela [i-la, i]
  const dqVal = new Float64Array(cap);
  let head = 0;
  let size = 0;
  const sm = new Float64Array(w); // ganho já com release, das últimas la+1 amostras
  let s = 1;
  let acc = 0;
  for (let i = 0; i < total; i++) {
    const h = i < n ? Math.min(1, ceiling / Math.max(linkedLevel(audio, i) * inGain, 1e-12)) : 1;
    while (size > 0 && dqVal[(head + size - 1) % cap] >= h) size--;
    dqIdx[(head + size) % cap] = i;
    dqVal[(head + size) % cap] = h;
    size++;
    if (dqIdx[head] < i - la) {
      head = (head + 1) % cap;
      size--;
    }
    const v = dqVal[head];
    s = v < s ? v : aRel * s + (1 - aRel) * v;
    sm[i % w] = s;
    acc += s;
    if (i < la) continue;

    // y[k] = x[k] * média(ganho[k .. k+la]); a amostra i ainda não foi alterada (k < i)
    const k = i - la;
    const g = (acc / w) * inGain;
    for (const ch of audio) {
      const y = ch[k] * g;
      ch[k] = y > ceiling ? ceiling : y < -ceiling ? -ceiling : y;
    }
    acc -= sm[k % w];
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
