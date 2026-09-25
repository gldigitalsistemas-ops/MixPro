"""Leitura/escrita de áudio via ffmpeg/ffprobe e soundfile.

Representação interna: numpy float32 com shape (canais, amostras).
"""

from __future__ import annotations

import json
import subprocess
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import soundfile as sf


class AudioError(Exception):
    """Arquivo inválido/corrompido — mensagem amigável ao usuário."""


@dataclass
class ProbeInfo:
    duration_s: float
    sample_rate: int
    channels: int
    codec: str
    bit_depth: int | None
    format_name: str


def probe(path: Path) -> ProbeInfo:
    try:
        out = subprocess.run(
            ["ffprobe", "-v", "error", "-print_format", "json", "-show_streams", "-show_format",
             "-select_streams", "a:0", str(path)],
            capture_output=True, check=True, timeout=60,
        ).stdout
        data = json.loads(out)
    except (subprocess.CalledProcessError, json.JSONDecodeError, subprocess.TimeoutExpired) as exc:
        raise AudioError("Não foi possível ler o arquivo. Ele pode estar corrompido ou em formato não suportado.") from exc

    streams = data.get("streams") or []
    if not streams:
        raise AudioError("O arquivo não contém uma faixa de áudio.")
    st = streams[0]
    fmt = data.get("format", {})
    duration = float(st.get("duration") or fmt.get("duration") or 0)
    bits = st.get("bits_per_raw_sample") or st.get("bits_per_sample")
    bit_depth = int(bits) if bits and int(bits) > 0 else None
    sample_fmt = st.get("sample_fmt", "")
    if bit_depth is None and sample_fmt.startswith("s16"):
        bit_depth = 16
    elif bit_depth is None and sample_fmt.startswith("s32"):
        bit_depth = 32
    return ProbeInfo(
        duration_s=duration,
        sample_rate=int(st.get("sample_rate") or 0),
        channels=int(st.get("channels") or 0),
        codec=st.get("codec_name", ""),
        bit_depth=bit_depth,
        format_name=fmt.get("format_name", ""),
    )


def decode(path: Path, start_s: float = 0.0, duration_s: float | None = None,
           channels: int | None = None, sample_rate: int | None = None) -> tuple[np.ndarray, int]:
    """Decodifica para float32 (canais, amostras). Mais de 2 canais → estéreo."""
    info = probe(path)
    ch = channels or min(max(info.channels, 1), 2)
    sr = sample_rate or info.sample_rate
    cmd = ["ffmpeg", "-v", "error", "-nostdin"]
    if start_s > 0:
        cmd += ["-ss", f"{start_s:.6f}"]
    cmd += ["-i", str(path)]
    if duration_s is not None:
        cmd += ["-t", f"{duration_s:.6f}"]
    cmd += ["-map", "0:a:0", "-f", "f32le", "-acodec", "pcm_f32le", "-ac", str(ch), "-ar", str(sr), "pipe:1"]
    try:
        raw = subprocess.run(cmd, capture_output=True, check=True, timeout=900).stdout
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired) as exc:
        raise AudioError("Falha ao decodificar o áudio. O arquivo pode estar corrompido.") from exc
    data = np.frombuffer(raw, dtype="<f4")
    if data.size == 0:
        raise AudioError("O arquivo não contém amostras de áudio.")
    data = data[: data.size - data.size % ch].reshape(-1, ch).T.copy()
    if not np.all(np.isfinite(data)):
        data = np.nan_to_num(data, nan=0.0, posinf=1.0, neginf=-1.0)
    return data.astype(np.float32, copy=False), sr


def _tpdf_dither(x: np.ndarray, bits: int, seed: int = 1234) -> np.ndarray:
    """Dither TPDF determinístico (mesma entrada → mesmo arquivo)."""
    rng = np.random.default_rng(seed)
    lsb = 1.0 / (2 ** (bits - 1))
    noise = (rng.random(x.shape, dtype=np.float32) - rng.random(x.shape, dtype=np.float32)) * lsb
    return x + noise


def write_audio(path: Path, audio: np.ndarray, sr: int, fmt: str, bit_depth: int = 24,
                mp3_bitrate_k: int = 320) -> Path:
    """Grava WAV/FLAC (soundfile) ou MP3 (ffmpeg/LAME). Valores fora de ±1 são limitados."""
    path.parent.mkdir(parents=True, exist_ok=True)
    x = np.clip(audio, -1.0, 1.0)
    if fmt in ("wav", "flac"):
        if fmt == "flac" and bit_depth > 24:
            bit_depth = 24
        if bit_depth == 32 and fmt == "wav":
            subtype = "FLOAT"
        else:
            subtype = "PCM_16" if bit_depth <= 16 else "PCM_24"
            if bit_depth <= 16:
                x = np.clip(_tpdf_dither(x, 16), -1.0, 1.0)
        sf.write(str(path), x.T, sr, subtype=subtype, format=fmt.upper())
        return path
    if fmt == "mp3":
        pcm = np.ascontiguousarray(x.T.astype("<f4"))
        cmd = ["ffmpeg", "-v", "error", "-nostdin", "-y", "-f", "f32le", "-ar", str(sr), "-ac", str(x.shape[0]),
               "-i", "pipe:0", "-codec:a", "libmp3lame", "-b:a", f"{mp3_bitrate_k}k", str(path)]
        subprocess.run(cmd, input=pcm.tobytes(), check=True, capture_output=True, timeout=900)
        return path
    raise ValueError(f"Formato não suportado: {fmt}")
