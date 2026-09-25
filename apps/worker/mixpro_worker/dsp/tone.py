"""Ganho, saturação, soft clip e normalização."""

from __future__ import annotations

import math

import numpy as np
from scipy.signal import butter, resample_poly, sosfilt

from ..analysis import loudness

OVERSAMPLE = 4


def gain(audio: np.ndarray, sr: int, gain_db: float) -> np.ndarray:
    if abs(gain_db) < 1e-4:
        return audio
    return (audio * np.float32(10 ** (gain_db / 20))).astype(np.float32, copy=False)


def _oversampled(audio: np.ndarray, fn) -> np.ndarray:
    n = audio.shape[1]
    up = resample_poly(audio, OVERSAMPLE, 1, axis=1)
    down = resample_poly(fn(up), 1, OVERSAMPLE, axis=1)
    return down[:, :n].astype(np.float32, copy=False)


def saturation(audio: np.ndarray, sr: int, mode: str, drive_db: float, mix: float, output_db: float) -> np.ndarray:
    m = min(max(mix / 100.0, 0.0), 1.0)
    if m <= 1e-4:
        return gain(audio, sr, output_db)
    g = 10 ** (drive_db / 20)

    if mode == "tube":
        bias = 0.25
        norm = g * (1 - math.tanh(bias) ** 2)
        curve = lambda x: (np.tanh(g * x + bias) - math.tanh(bias)) / norm  # noqa: E731
    elif mode == "hard":
        curve = lambda x: np.clip(g * x, -1.0, 1.0) / g  # noqa: E731
    else:  # tape
        curve = lambda x: np.tanh(g * x) / g  # noqa: E731

    wet = _oversampled(audio, curve)
    if mode == "tube":  # remove o DC gerado pela assimetria
        wet = sosfilt(butter(1, 5.0, btype="highpass", fs=sr, output="sos"), wet, axis=1).astype(np.float32)
    out = audio * np.float32(1 - m) + wet * np.float32(m)
    return gain(out.astype(np.float32, copy=False), sr, output_db)


def soft_clip(audio: np.ndarray, sr: int, ceiling_db: float, input_gain_db: float) -> np.ndarray:
    c = 10 ** (ceiling_db / 20)
    g = 10 ** (input_gain_db / 20)
    y = _oversampled(audio, lambda x: c * np.tanh(g * x / c))
    return np.clip(y, -c, c).astype(np.float32, copy=False)


def normalize(audio: np.ndarray, sr: int, mode: str, target_db: float) -> np.ndarray:
    if mode == "peak":
        peak = float(np.max(np.abs(audio))) if audio.size else 0.0
        if peak <= 1e-9:
            return audio
        return gain(audio, sr, target_db - 20 * math.log10(peak))
    lufs = loudness(audio, sr)
    if not math.isfinite(lufs):
        return audio
    return gain(audio, sr, target_db - lufs)
