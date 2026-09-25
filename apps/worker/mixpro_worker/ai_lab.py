"""Processamento de jobs do AI Audio Lab: separação de stems e redução de ruído."""

from __future__ import annotations

import logging
from pathlib import Path
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from .jobs import JobContext

log = logging.getLogger("mixpro.ai_lab")

STEM_TYPES_2 = ["vocals", "other"]
STEM_TYPES_4 = ["vocals", "drums", "bass", "other"]
STEM_TYPES_6 = ["vocals", "drums", "bass", "guitar", "piano", "other"]


def _stem_types(n: int) -> list[str]:
    if n == 2:
        return STEM_TYPES_2
    if n == 6:
        return STEM_TYPES_6
    return STEM_TYPES_4


def _try_demucs(source_path: Path, out_dir: Path, model: str, n_stems: int) -> dict[str, Path]:
    """Tenta usar demucs localmente. Retorna mapa stem_type→arquivo ou levanta ImportError."""
    import torch  # type: ignore[import-untyped]
    from demucs.apply import apply_model  # type: ignore[import-untyped]
    from demucs.audio import AudioFile  # type: ignore[import-untyped]
    from demucs.pretrained import get_model  # type: ignore[import-untyped]

    device = "cuda" if torch.cuda.is_available() else "cpu"
    model_obj = get_model(model)
    model_obj.to(device)

    audio = AudioFile(source_path).read(streams=0, samplerate=model_obj.samplerate, channels=model_obj.audio_channels)
    audio = audio.unsqueeze(0).to(device)
    sources = apply_model(model_obj, audio, device=device, shifts=1, split=True, overlap=0.25, progress=True)
    sources = sources[0].cpu()

    stem_names = model_obj.sources
    out: dict[str, Path] = {}
    for i, name in enumerate(stem_names):
        if name not in _stem_types(n_stems):
            continue
        out_path = out_dir / f"{name}.wav"
        import torchaudio  # type: ignore[import-untyped]
        torchaudio.save(str(out_path), sources[i], model_obj.samplerate)
        out[name] = out_path

    return out


def _try_external_api(ctx: "JobContext", source_path: Path, out_dir: Path, model: str, n_stems: int) -> dict[str, Path]:
    """Chama serviço externo de separação de stems (ex: AudioShake, Moises.ai)."""
    import httpx  # type: ignore[import-untyped]

    service_url = str(ctx.settings.get("ai_lab_service_url", "")).strip('"')
    if not service_url:
        raise RuntimeError("Serviço de IA não configurado (ai_lab_service_url vazio).")

    with source_path.open("rb") as f:
        resp = httpx.post(
            f"{service_url}/separate",
            files={"audio": (source_path.name, f, "audio/wav")},
            data={"model": model, "stems": str(n_stems)},
            timeout=300,
        )
    resp.raise_for_status()
    data = resp.json()  # espera {"vocals": "<url>", "drums": "<url>", ...}

    out: dict[str, Path] = {}
    for stem_type in _stem_types(n_stems):
        url = data.get(stem_type)
        if not url:
            continue
        r = httpx.get(url, timeout=120)
        r.raise_for_status()
        path = out_dir / f"{stem_type}.wav"
        path.write_bytes(r.content)
        out[stem_type] = path

    return out


def run_ai_stem_separate(ctx: "JobContext") -> None:
    """Handler para jobs do tipo ai_stem_separate."""
    job = ctx.job
    params: dict[str, Any] = job.get("params") or {}
    model = str(params.get("model", "htdemucs"))
    n_stems = int(params.get("stems", 4))

    ctx.progress(5, "Baixando arquivo de origem…")
    file_info = ctx.file(job["source_file_id"])
    source_local = ctx.storage.cached_source(file_info["storage_key"])

    out_dir = ctx.tmp / "stems"
    out_dir.mkdir(exist_ok=True)

    ctx.progress(15, "Separando stems…")
    stem_files: dict[str, Path] = {}

    # Tenta demucs local primeiro, depois serviço externo
    try:
        stem_files = _try_demucs(source_local, out_dir, model, n_stems)
        log.info("stems separados com demucs local", extra={"fields": {"job_id": job["id"], "model": model}})
    except (ImportError, ModuleNotFoundError):
        log.info("demucs não disponível; tentando serviço externo", extra={"fields": {"job_id": job["id"]}})
        try:
            stem_files = _try_external_api(ctx, source_local, out_dir, model, n_stems)
        except Exception as exc:
            raise RuntimeError(f"Separação de stems não disponível: {exc}") from exc

    if not stem_files:
        raise RuntimeError("Nenhum stem foi gerado.")

    # Faz upload de cada stem e registra no banco
    prefix = f"users/{job['user_id']}/ai_stems/{job['id']}/"
    total = len(stem_files)
    for i, (stem_type, local_path) in enumerate(stem_files.items()):
        pct = 40 + int((i / total) * 50)
        ctx.progress(pct, f"Enviando stem: {stem_type}…")

        storage_key = f"{prefix}{stem_type}.wav"
        ctx.storage.upload(local_path, storage_key)

        ctx.db.insert("ai_stem_outputs", {
            "job_id": job["id"],
            "user_id": job["user_id"],
            "stem_type": stem_type,
            "storage_key": storage_key,
            "file_name": f"{stem_type}.wav",
            "size_bytes": local_path.stat().st_size,
        })

    ctx.progress(99, "Finalizando…")
    # execute() marca o job como completed após o handler retornar
