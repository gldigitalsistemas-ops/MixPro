"""Filtros e equalizadores (Butterworth + biquads RBJ Audio EQ Cookbook)."""

from __future__ import annotations

import math

import numpy as np
from scipy.signal import butter, sosfilt


def _clamp_freq(freq: float, sr: int) -> float:
    return float(min(max(freq, 10.0), sr * 0.49))


def _apply(sos: np.ndarray, audio: np.ndarray) -> np.ndarray:
    return sosfilt(sos, audio, axis=1).astype(np.float32, copy=False)


def _slope_to_order(slope: str | int) -> int:
    return {6: 1, 12: 2, 18: 3, 24: 4}[int(slope)]


def highpass(audio: np.ndarray, sr: int, frequency_hz: float, slope_db_oct: str) -> np.ndarray:
    sos = butter(_slope_to_order(slope_db_oct), _clamp_freq(frequency_hz, sr), btype="highpass", fs=sr, output="sos")
    return _apply(sos, audio)


def lowpass(audio: np.ndarray, sr: int, frequency_hz: float, slope_db_oct: str) -> np.ndarray:
    if frequency_hz >= sr * 0.49:
        return audio
    sos = butter(_slope_to_order(slope_db_oct), _clamp_freq(frequency_hz, sr), btype="lowpass", fs=sr, output="sos")
    return _apply(sos, audio)


def _biquad_sos(b0: float, b1: float, b2: float, a0: float, a1: float, a2: float) -> np.ndarray:
    return np.array([[b0 / a0, b1 / a0, b2 / a0, 1.0, a1 / a0, a2 / a0]], dtype=np.float64)


def peaking_sos(sr: int, freq: float, gain_db: float, q: float) -> np.ndarray:
    a = 10 ** (gain_db / 40)
    w0 = 2 * math.pi * _clamp_freq(freq, sr) / sr
    alpha = math.sin(w0) / (2 * q)
    cw = math.cos(w0)
    return _biquad_sos(1 + alpha * a, -2 * cw, 1 - alpha * a, 1 + alpha / a, -2 * cw, 1 - alpha / a)


def shelf_sos(sr: int, freq: float, gain_db: float, q: float, position: str) -> np.ndarray:
    a = 10 ** (gain_db / 40)
    w0 = 2 * math.pi * _clamp_freq(freq, sr) / sr
    alpha = math.sin(w0) / (2 * q)
    cw = math.cos(w0)
    sa = 2 * math.sqrt(a) * alpha
    if position == "low":
        return _biquad_sos(
            a * ((a + 1) - (a - 1) * cw + sa), 2 * a * ((a - 1) - (a + 1) * cw), a * ((a + 1) - (a - 1) * cw - sa),
            (a + 1) + (a - 1) * cw + sa, -2 * ((a - 1) + (a + 1) * cw), (a + 1) + (a - 1) * cw - sa,
        )
    return _biquad_sos(
        a * ((a + 1) + (a - 1) * cw + sa), -2 * a * ((a - 1) + (a + 1) * cw), a * ((a + 1) + (a - 1) * cw - sa),
        (a + 1) - (a - 1) * cw + sa, 2 * ((a - 1) - (a + 1) * cw), (a + 1) - (a - 1) * cw - sa,
    )


def eq_peak(audio: np.ndarray, sr: int, frequency_hz: float, gain_db: float, q: float) -> np.ndarray:
    if abs(gain_db) < 1e-3:
        return audio
    return _apply(peaking_sos(sr, frequency_hz, gain_db, q), audio)


def eq_shelf(audio: np.ndarray, sr: int, position: str, frequency_hz: float, gain_db: float, q: float) -> np.ndarray:
    if abs(gain_db) < 1e-3:
        return audio
    return _apply(shelf_sos(sr, frequency_hz, gain_db, q, position), audio)
