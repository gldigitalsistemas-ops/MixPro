"""Processadores de dinâmica (compilados com numba para rodar em tempo útil)."""

from __future__ import annotations

import math

import numpy as np
from numba import njit


def _coef(ms: float, sr: int) -> float:
    return math.exp(-1.0 / max(ms * 1e-3 * sr, 1e-6))


# ---------------------------------------------------------------------------
# Compressor feed-forward, domínio logarítmico, knee suave, link estéreo
# (Giannoulis, Massberg & Reiss, JAES 2012)
# ---------------------------------------------------------------------------
@njit(cache=True, fastmath=False)
def _compress(x, thr, ratio, knee, a_att, a_rel, makeup_db):
    ch, n = x.shape
    out = np.empty_like(x)
    gs = 0.0
    slope = 1.0 / ratio - 1.0
    for i in range(n):
        lvl = 0.0
        for c in range(ch):
            v = abs(x[c, i])
            if v > lvl:
                lvl = v
        xdb = 20.0 * math.log10(lvl if lvl > 1e-9 else 1e-9)
        over = xdb - thr
        if knee > 0.0 and 2.0 * abs(over) <= knee:
            gc = slope * (over + knee / 2.0) ** 2 / (2.0 * knee)
        elif over > 0.0:
            gc = slope * over
        else:
            gc = 0.0
        if gc < gs:
            gs = a_att * gs + (1.0 - a_att) * gc
        else:
            gs = a_rel * gs + (1.0 - a_rel) * gc
        g = 10.0 ** ((gs + makeup_db) / 20.0)
        for c in range(ch):
            out[c, i] = x[c, i] * g
    return out


def compressor(audio: np.ndarray, sr: int, threshold_db: float, ratio: float, attack_ms: float,
               release_ms: float, knee_db: float, makeup_db: float) -> np.ndarray:
    if ratio <= 1.0001 and abs(makeup_db) < 1e-3:
        return audio
    return _compress(np.ascontiguousarray(audio, dtype=np.float32), float(threshold_db), float(max(ratio, 1.0)),
                     float(knee_db), _coef(attack_ms, sr), _coef(release_ms, sr), float(makeup_db))


# ---------------------------------------------------------------------------
# Limiter com lookahead (min-hold + média móvel → sem overshoot)
# ---------------------------------------------------------------------------
@njit(cache=True)
def _limiter_gain(g_req, lookahead, a_rel):
    n = g_req.shape[0]
    h = np.empty(n, dtype=np.float64)
    dq = np.empty(n, dtype=np.int64)
    head = 0
    tail = 0
    for i in range(n):
        while tail > head and g_req[dq[tail - 1]] >= g_req[i]:
            tail -= 1
        dq[tail] = i
        tail += 1
        if dq[head] < i - lookahead:
            head += 1
        h[i] = g_req[dq[head]]
    s = 1.0
    for i in range(n):
        if h[i] < s:
            s = h[i]
        else:
            s = a_rel * s + (1.0 - a_rel) * h[i]
        h[i] = s
    return h


def limiter(audio: np.ndarray, sr: int, ceiling_db: float, input_gain_db: float, release_ms: float,
            lookahead_ms: float) -> np.ndarray:
    ceiling = 10 ** (ceiling_db / 20)
    x = audio * np.float32(10 ** (input_gain_db / 20))
    ch, n = x.shape
    la = max(1, int(round(lookahead_ms * 1e-3 * sr)))
    xp = np.concatenate([x, np.zeros((ch, la), dtype=np.float32)], axis=1)
    peak = np.max(np.abs(xp), axis=0).astype(np.float64)
    g_req = np.minimum(1.0, ceiling / np.maximum(peak, 1e-12))
    h = _limiter_gain(g_req, la, _coef(release_ms, sr))
    # média móvel "para trás" de la+1 amostras (valores antes do início = 1)
    hp = np.concatenate([np.ones(la), h])
    cs = np.concatenate([[0.0], np.cumsum(hp)])
    avg = (cs[la + 1:] - cs[: len(h)]) / (la + 1)
    # atrasa o áudio em `la` e remove a latência no final
    delayed = np.concatenate([np.zeros((ch, la), dtype=np.float32), xp[:, :n]], axis=1)
    y = (delayed * avg[None, : n + la].astype(np.float32))[:, la: la + n]
    return np.clip(y, -ceiling, ceiling).astype(np.float32, copy=False)


# ---------------------------------------------------------------------------
# Gate / expander descendente com hold e atenuação máxima
# ---------------------------------------------------------------------------
@njit(cache=True)
def _gate(x, thr, range_db, ratio, a_att, a_rel, a_env, hold):
    ch, n = x.shape
    out = np.empty_like(x)
    env = 0.0
    g = 0.0
    hold_left = 0
    for i in range(n):
        lvl = 0.0
        for c in range(ch):
            v = abs(x[c, i])
            if v > lvl:
                lvl = v
        env = lvl if lvl > env else a_env * env + (1.0 - a_env) * lvl
        edb = 20.0 * math.log10(env if env > 1e-9 else 1e-9)
        if edb >= thr:
            target = 0.0
            hold_left = hold
        elif hold_left > 0:
            hold_left -= 1
            target = 0.0
        else:
            target = (edb - thr) * (ratio - 1.0)
            if target < -range_db:
                target = -range_db
        if target > g:
            g = a_att * g + (1.0 - a_att) * target
        else:
            g = a_rel * g + (1.0 - a_rel) * target
        gl = 10.0 ** (g / 20.0)
        for c in range(ch):
            out[c, i] = x[c, i] * gl
    return out


def gate(audio: np.ndarray, sr: int, threshold_db: float, range_db: float, ratio: float, attack_ms: float,
         hold_ms: float, release_ms: float) -> np.ndarray:
    if range_db <= 0.01:
        return audio
    return _gate(np.ascontiguousarray(audio, dtype=np.float32), float(threshold_db), float(range_db),
                 float(max(ratio, 1.0)), _coef(attack_ms, sr), _coef(release_ms, sr), _coef(10.0, sr),
                 int(hold_ms * 1e-3 * sr))
