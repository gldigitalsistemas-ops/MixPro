"""Largura estéreo, delay e reverb. O comprimento do áudio é preservado
(caudas além do fim são descartadas para manter alinhamento com vídeo/pistas)."""

from __future__ import annotations

import math

import numpy as np
from numba import njit
from pedalboard import Reverb
from scipy.signal import butter, sosfilt


def stereo_width(audio: np.ndarray, sr: int, width: float, bass_mono_hz: float) -> np.ndarray:
    if audio.shape[0] != 2:
        return audio
    if abs(width - 100) < 0.01 and bass_mono_hz <= 0:
        return audio
    mid = (audio[0] + audio[1]) * 0.5
    side = (audio[0] - audio[1]) * 0.5 * (width / 100.0)
    if bass_mono_hz > 0:
        sos = butter(2, min(bass_mono_hz, sr * 0.45), btype="highpass", fs=sr, output="sos")
        side = sosfilt(sos, side)
    return np.stack([mid + side, mid - side]).astype(np.float32, copy=False)


@njit(cache=True)
def _feedback_delay(x, d, fb, a_lp):
    ch, n = x.shape
    wet = np.zeros_like(x)
    line = np.zeros_like(x)
    for c in range(ch):
        lp = 0.0
        for i in range(n):
            tap = line[c, i - d] if i >= d else 0.0
            lp = (1.0 - a_lp) * tap + a_lp * lp
            wet[c, i] = lp
            line[c, i] = x[c, i] + fb * lp
    return wet


def delay(audio: np.ndarray, sr: int, time_ms: float, feedback: float, lowpass_hz: float, mix: float) -> np.ndarray:
    m = min(max(mix / 100.0, 0.0), 1.0)
    if m <= 1e-4:
        return audio
    d = max(1, int(round(time_ms * 1e-3 * sr)))
    a_lp = math.exp(-2 * math.pi * min(lowpass_hz, sr * 0.45) / sr)
    wet = _feedback_delay(np.ascontiguousarray(audio, dtype=np.float32), d, float(min(feedback, 95) / 100.0), a_lp)
    return (audio * np.float32(1 - m) + wet * np.float32(m)).astype(np.float32, copy=False)


def reverb(audio: np.ndarray, sr: int, room_size: float, damping: float, width: float, predelay_ms: float,
           mix: float) -> np.ndarray:
    m = min(max(mix / 100.0, 0.0), 1.0)
    if m <= 1e-4:
        return audio
    pre = int(round(predelay_ms * 1e-3 * sr))
    src = audio
    if pre > 0:
        src = np.concatenate([np.zeros((audio.shape[0], pre), dtype=np.float32), audio[:, :-pre]], axis=1) \
            if pre < audio.shape[1] else np.zeros_like(audio)
    rv = Reverb(room_size=room_size / 100.0, damping=damping / 100.0, wet_level=1.0, dry_level=0.0,
                width=width / 100.0, freeze_mode=0.0)
    wet = rv.process(np.ascontiguousarray(src, dtype=np.float32), sr, reset=True)
    return (audio * np.float32(1 - m) + wet[:, : audio.shape[1]] * np.float32(m)).astype(np.float32, copy=False)
