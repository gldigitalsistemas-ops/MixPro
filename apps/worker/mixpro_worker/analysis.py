"""Análises informativas: pico, true peak, RMS, LUFS, clipping, silêncio e picos p/ waveform."""

from __future__ import annotations

import math
from typing import Any

import numpy as np
import pyloudnorm
from scipy.signal import resample_poly

SILENCE_DBFS = -90.0


def db(x: float) -> float:
    return 20.0 * math.log10(x) if x > 0 else float("-inf")


def _finite(v: float) -> float | None:
    return round(v, 2) if math.isfinite(v) else None


def true_peak(audio: np.ndarray) -> float:
    """True peak aproximado por oversampling 4x (ITU-R BS.1770)."""
    step = 48000 * 30  # blocos p/ limitar memória
    peak = 0.0
    n = audio.shape[1]
    for start in range(0, n, step):
        block = audio[:, start:start + step + 64]
        if block.shape[1] < 8:
            peak = max(peak, float(np.max(np.abs(block))) if block.size else 0.0)
            continue
        up = resample_poly(block, 4, 1, axis=1)
        peak = max(peak, float(np.max(np.abs(up))))
    return peak


def clipping_runs(audio: np.ndarray, threshold: float = 0.999, min_run: int = 3) -> int:
    """Conta trechos com ≥ min_run amostras consecutivas no teto (clipping digital)."""
    mask = np.any(np.abs(audio) >= threshold, axis=0).astype(np.int8)
    if not mask.any():
        return 0
    edges = np.diff(np.concatenate(([0], mask, [0])))
    starts = np.flatnonzero(edges == 1)
    ends = np.flatnonzero(edges == -1)
    return int(np.sum((ends - starts) >= min_run))


def loudness(audio: np.ndarray, sr: int) -> float:
    if audio.shape[1] < int(0.4 * sr):
        return float("-inf")
    meter = pyloudnorm.Meter(sr)
    with np.errstate(divide="ignore"):
        return float(meter.integrated_loudness(audio.T.astype(np.float64)))


def analyze(audio: np.ndarray, sr: int) -> dict[str, Any]:
    peak = float(np.max(np.abs(audio))) if audio.size else 0.0
    rms = float(np.sqrt(np.mean(np.square(audio, dtype=np.float64)))) if audio.size else 0.0
    tp = true_peak(audio)
    lufs = loudness(audio, sr)
    return {
        "peak_dbfs": _finite(db(peak)),
        "true_peak_dbtp": _finite(db(tp)),
        "rms_dbfs": _finite(db(rms)),
        "lufs_integrated": _finite(lufs),
        # PLR (peak-to-loudness): indicador informativo de dinâmica
        "dynamic_range_db": _finite(db(tp) - lufs) if math.isfinite(lufs) and tp > 0 else None,
        "clipping_runs": clipping_runs(audio),
        "silent": peak <= 10 ** (SILENCE_DBFS / 20),
    }


def warnings_for(stats: dict[str, Any], sr: int, channels: int) -> list[str]:
    w: list[str] = []
    if stats["clipping_runs"] >= 10:
        w.append("clipping")
    if stats["peak_dbfs"] is not None and stats["peak_dbfs"] < -30:
        w.append("low_level")
    if sr < 44100:
        w.append("low_sample_rate")
    if channels > 2:
        w.append("downmixed_to_stereo")
    return w


def loudest_window_start(audio: np.ndarray, sr: int, window_s: float) -> float:
    """Início (s) da janela de `window_s` com maior energia — sugestão de trecho p/ preview."""
    n = audio.shape[1]
    win = int(window_s * sr)
    if n <= win:
        return 0.0
    hop = max(1, sr // 10)  # resolução de 100 ms
    frames = n // hop
    energy = np.square(audio[:, : frames * hop].astype(np.float64)).sum(axis=0).reshape(frames, hop).sum(axis=1)
    cs = np.concatenate(([0.0], np.cumsum(energy)))
    w = max(1, win // hop)
    sums = cs[w:] - cs[:-w]
    best = int(np.argmax(sums)) if sums.size else 0
    return round(min(best * hop / sr, (n - win) / sr), 1)


def waveform_peaks(audio: np.ndarray, buckets: int) -> list[int]:
    """Picos absolutos por bloco, quantizados 0–255 (JSON leve para o front)."""
    mono = np.max(np.abs(audio), axis=0)
    n = mono.shape[0]
    buckets = max(1, min(buckets, n))
    edges = np.linspace(0, n, buckets + 1).astype(np.int64)
    peaks = np.maximum.reduceat(mono, edges[:-1]) if n else np.zeros(buckets)
    return np.clip(np.round(np.minimum(peaks, 1.0) * 255), 0, 255).astype(int).tolist()
