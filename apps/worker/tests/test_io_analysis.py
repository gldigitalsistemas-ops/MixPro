"""Testes de E/S (ffmpeg/soundfile) e análise."""

import numpy as np
import pytest

from mixpro_worker import analysis
from mixpro_worker.audio_io import AudioError, decode, probe, write_audio

SR = 44100


def tone(seconds=1.0, db=-6.0):
    t = np.arange(int(SR * seconds)) / SR
    x = (10 ** (db / 20) * np.sin(2 * np.pi * 440 * t)).astype(np.float32)
    return np.stack([x, x * 0.5])


@pytest.mark.parametrize("fmt,bits", [("wav", 16), ("wav", 24), ("flac", 24), ("mp3", 24)])
def test_roundtrip_formatos(tmp_path, fmt, bits):
    x = tone()
    path = write_audio(tmp_path / f"a.{fmt}", x, SR, fmt, bits)
    info = probe(path)
    assert info.sample_rate == SR and info.channels == 2
    y, sr = decode(path)
    assert sr == SR
    if fmt != "mp3":
        assert y.shape == x.shape
        assert np.max(np.abs(y - x)) < (1e-4 if bits == 24 else 2e-4)


def test_decode_trecho(tmp_path):
    path = write_audio(tmp_path / "a.flac", tone(seconds=3), SR, "flac", 24)
    y, _ = decode(path, start_s=1.0, duration_s=0.5)
    assert abs(y.shape[1] - SR // 2) <= 2


def test_arquivo_corrompido(tmp_path):
    bad = tmp_path / "x.wav"
    bad.write_bytes(b"RIFF....nao e audio")
    with pytest.raises(AudioError):
        probe(bad)


def test_analise_clipping_e_true_peak():
    x = tone(db=0) * 1.5
    x = np.clip(x, -1, 1)
    stats = analysis.analyze(x, SR)
    assert stats["clipping_runs"] > 10
    assert "clipping" in analysis.warnings_for(stats, SR, 2)
    assert stats["true_peak_dbtp"] >= stats["peak_dbfs"] - 0.01


def test_silencio_detectado():
    stats = analysis.analyze(np.zeros((2, SR), dtype=np.float32), SR)
    assert stats["silent"]


def test_waveform_peaks():
    peaks = analysis.waveform_peaks(tone(), 100)
    assert len(peaks) == 100 and max(peaks) <= 255 and min(peaks) >= 0


def test_trecho_mais_alto_sugerido():
    quiet = tone(seconds=20, db=-40)
    loud = tone(seconds=10, db=-6)
    x = np.concatenate([quiet, loud, quiet], axis=1)
    start = analysis.loudest_window_start(x, SR, 10)
    assert abs(start - 20.0) <= 0.2
    assert analysis.loudest_window_start(tone(seconds=5), SR, 30) == 0.0
