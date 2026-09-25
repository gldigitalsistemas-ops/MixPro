"""Execução dos jobs: analyze, preview, render e AI Lab."""

from __future__ import annotations

import hashlib
import json
import logging
import shutil
import subprocess
import time
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import numpy as np

from . import analysis
from .audio_io import AudioError, decode, probe, write_audio
from .db import Db, DbError
from .dsp import ChainError, run_chain
from .storage import Storage

log = logging.getLogger("mixpro.jobs")

PCM_LOSSLESS_TO_FLAC = {"pcm_s16le", "pcm_s16be", "pcm_s24le", "pcm_s24be"}
PREROLL_S = 2.0


class JobError(Exception):
    """Erro de job com código e mensagem amigável (exibida ao usuário)."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


def now_iso(delta: timedelta | None = None) -> str:
    return (datetime.now(timezone.utc) + (delta or timedelta())).isoformat()


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def setting(settings: dict[str, Any], key: str, default: Any) -> Any:
    v = settings.get(key, default)
    return default if v is None else v


@dataclass
class JobContext:
    db: Db
    storage: Storage
    job: dict[str, Any]
    settings: dict[str, Any]
    work_dir: Path
    tmp: Path = field(init=False)

    def __post_init__(self) -> None:
        self.tmp = self.work_dir / "jobs" / self.job["id"]
        self.tmp.mkdir(parents=True, exist_ok=True)

    def cleanup(self) -> None:
        shutil.rmtree(self.tmp, ignore_errors=True)

    def progress(self, pct: int, stage: str) -> None:
        self.db.update("processing_jobs", {"id": f"eq.{self.job['id']}"},
                       {"progress": max(1, min(99, pct)), "stage": stage, "heartbeat_at": now_iso()})

    @property
    def engine(self) -> str:
        return str(setting(self.settings, "dsp_engine_version", "1"))

    def file(self, file_id: str) -> dict[str, Any]:
        row = self.db.select_one("audio_files", {"id": f"eq.{file_id}", "select": "*"})
        if not row or row.get("deleted_at"):
            raise JobError("SOURCE_MISSING", "O arquivo original não está mais disponível.")
        return row

    def chain(self) -> tuple[dict[str, Any] | None, str | None]:
        pv_id = self.job.get("preset_version_id")
        if not pv_id:
            return None, None
        row = self.db.select_one("preset_versions", {"id": f"eq.{pv_id}", "select": "chain,version,presets!preset_versions_preset_id_fkey(name)"})
        if not row:
            raise JobError("PRESET_MISSING", "O preset selecionado não está disponível.")
        return row["chain"], (row.get("presets") or {}).get("name")


def _base_prefix(f: dict[str, Any]) -> str:
    return f"users/{f['user_id']}/projects/{f['project_id']}"


def _upload_peaks(ctx: JobContext, audio: np.ndarray, key: str, buckets: int) -> str:
    peaks_key = f"{key}.peaks.json"
    body = json.dumps({"v": 1, "peaks": analysis.waveform_peaks(audio, buckets)}, separators=(",", ":"))
    ctx.storage.upload_bytes(body.encode(), peaks_key, "application/json")
    return peaks_key


def _insert_output(ctx: JobContext, row: dict[str, Any]) -> dict[str, Any]:
    """Insere o arquivo gerado; se outro worker gerou o mesmo cache_key, reaproveita."""
    try:
        return ctx.db.insert("audio_files", row)
    except DbError as exc:
        if "23505" not in str(exc) or not row.get("cache_key"):
            raise
        ctx.storage.delete(row["storage_key"])
        existing = ctx.db.select_one("audio_files", {"cache_key": f"eq.{row['cache_key']}", "deleted_at": "is.null",
                                                      "status": "eq.ready", "select": "*"})
        if not existing:
            raise
        return existing


def _qc(audio: np.ndarray, sr: int, expected_samples: int, input_silent: bool) -> tuple[dict[str, Any], list[str]]:
    """Controle de qualidade pós-processamento."""
    if not np.all(np.isfinite(audio)):
        raise JobError("QC_INVALID_SAMPLES", "O processamento gerou um resultado inválido.")
    if abs(audio.shape[1] - expected_samples) > 1:
        raise JobError("QC_DURATION", "A duração do resultado não confere com o original.")
    stats = analysis.analyze(audio, sr)
    if stats["silent"] and not input_silent:
        raise JobError("QC_SILENT", "O processamento resultou em silêncio.")
    warnings = []
    if stats["peak_dbfs"] is not None and stats["peak_dbfs"] > 0.0:
        warnings.append("output_clipping")
    return stats, warnings


# ---------------------------------------------------------------------------
# ANALYZE — valida o upload, extrai metadados, gera waveform, compacta em FLAC
# ---------------------------------------------------------------------------
def run_analyze(ctx: JobContext) -> str:
    f = ctx.file(ctx.job["source_file_id"])
    ctx.db.update("audio_files", {"id": f"eq.{f['id']}"}, {"status": "analyzing"})
    ctx.progress(5, "Verificando arquivo…")
    try:
        local = ctx.storage.cached_source(f["storage_key"])
        info = probe(local)
        max_dur = float(setting(ctx.settings, "max_audio_duration_s", 900))
        if info.duration_s <= 0.1:
            raise AudioError("O áudio é curto demais para ser processado.")
        if info.duration_s > max_dur + 1:
            raise AudioError(f"O áudio ultrapassa a duração máxima de {int(max_dur // 60)} minutos.")
        if info.sample_rate < 8000:
            raise AudioError("Taxa de amostragem não suportada.")

        ctx.progress(20, "Lendo áudio…")
        audio, sr = decode(local)
        ctx.progress(45, "Analisando…")
        stats = analysis.analyze(audio, sr)
        if stats["silent"]:
            raise AudioError("O áudio não contém sinal (apenas silêncio).")
        warnings = analysis.warnings_for(stats, sr, info.channels)
        digest = sha256_file(local)

        ctx.progress(65, "Gerando forma de onda…")
        key = f["storage_key"]
        update: dict[str, Any] = {}
        if info.codec in PCM_LOSSLESS_TO_FLAC:
            # Compactação sem perdas (bit-exata): economiza ~40–60% de armazenamento.
            flac = ctx.tmp / "source.flac"
            subprocess.run(["ffmpeg", "-v", "error", "-nostdin", "-y", "-i", str(local), "-map", "0:a:0",
                            "-c:a", "flac", "-compression_level", "8", str(flac)], check=True, timeout=900)
            new_key = key.rsplit(".", 1)[0] + ".flac"
            size = ctx.storage.upload(flac, new_key, "audio/flac")
            ctx.storage.put_cache(new_key, flac)
            ctx.storage.delete(key)
            update |= {"storage_key": new_key, "size_bytes": size}
            key = new_key
        peaks_key = _upload_peaks(ctx, audio, key, 2400)

        ctx.db.update("audio_files", {"id": f"eq.{f['id']}"}, update | {
            "status": "ready", "sha256": digest, "duration_s": round(info.duration_s, 3),
            "sample_rate": sr, "bit_depth": info.bit_depth, "channels": info.channels, "codec": info.codec,
            "peaks_key": peaks_key, "warnings": warnings, "error_message": None,
            "analysis": stats | {"original_codec": info.codec,
                                 "stored_as": "flac" if "storage_key" in update else info.codec,
                                 "thumb": analysis.waveform_peaks(audio, 64),
                                 "suggested_preview_start": analysis.loudest_window_start(
                                     audio, sr, float(setting(ctx.settings, "preview_duration_s", 30)))},
        })
        return f["id"]
    except AudioError as exc:
        ctx.db.update("audio_files", {"id": f"eq.{f['id']}"}, {"status": "invalid", "error_message": str(exc)})
        raise JobError("INVALID_AUDIO", str(exc)) from exc


# ---------------------------------------------------------------------------
# PREVIEW — trecho curto: original (A) + processado (B), ambos em FLAC
# ---------------------------------------------------------------------------
def _segment_cache_key(sha: str, start: float, dur: float, engine: str) -> str:
    return hashlib.sha256(f"segment|{sha}|{start:.1f}|{dur:.3f}|engine{engine}".encode()).hexdigest()


def run_preview(ctx: JobContext) -> str:
    job = ctx.job
    src = ctx.file(job["source_file_id"])
    params = job.get("params") or {}
    start = float(params.get("start_s") or 0)
    dur = float(params.get("duration_s") or 30)
    chain, _ = ctx.chain()
    retention = timedelta(days=int(setting(ctx.settings, "retention_preview_days", 7)))

    ctx.progress(10, "Preparando áudio…")
    local = ctx.storage.cached_source(src["storage_key"])
    preroll = min(start, PREROLL_S)
    audio, sr = decode(local, start_s=start - preroll, duration_s=dur + preroll)
    pre_n = int(round(preroll * sr))
    original = audio[:, pre_n:]
    n = original.shape[1]

    # A — trecho original (cache próprio, compartilhado entre presets)
    seg_key = _segment_cache_key(src["sha256"], start, dur, ctx.engine)
    segment = ctx.db.select_one("audio_files", {"cache_key": f"eq.{seg_key}", "status": "eq.ready",
                                                "deleted_at": "is.null", "select": "*"})
    if segment:
        ctx.db.update("audio_files", {"id": f"eq.{segment['id']}"}, {"last_accessed_at": now_iso()})
    else:
        seg_path = write_audio(ctx.tmp / "segment.flac", original, sr, "flac", 24)
        seg_storage = f"{_base_prefix(src)}/segments/{seg_key[:32]}.flac"
        size = ctx.storage.upload(seg_path, seg_storage)
        segment = _insert_output(ctx, {
            "user_id": src["user_id"], "project_id": src["project_id"], "kind": "segment", "status": "ready",
            "storage_key": seg_storage, "ext": "flac", "mime": "audio/flac", "size_bytes": size,
            "duration_s": round(n / sr, 3), "sample_rate": sr, "channels": original.shape[0], "codec": "flac",
            "bit_depth": 24, "derived_from": src["id"], "cache_key": seg_key,
            "peaks_key": _upload_peaks(ctx, original, seg_storage, 800),
            "analysis": analysis.analyze(original, sr), "expires_at": now_iso(retention),
        })

    if not chain:
        return segment["id"]

    # B — processado com o preset (pré-roll aquece dinâmica/reverb e é descartado)
    ctx.progress(35, "Processando…")
    processed = run_chain(audio, sr, chain, int(job["intensity"]),
                          on_step=lambda i, t: ctx.progress(35 + int(45 * i / t), "Processando…"))[:, pre_n:]
    ctx.progress(85, "Finalizando…")
    stats, warnings = _qc(processed, sr, n, bool((segment.get("analysis") or {}).get("silent")))
    out_path = write_audio(ctx.tmp / "preview.flac", processed, sr, "flac", 24)
    out_key = f"{_base_prefix(src)}/previews/{job['cache_key'][:32]}.flac"
    size = ctx.storage.upload(out_path, out_key)
    out = _insert_output(ctx, {
        "user_id": src["user_id"], "project_id": src["project_id"], "kind": "preview", "status": "ready",
        "storage_key": out_key, "ext": "flac", "mime": "audio/flac", "size_bytes": size,
        "duration_s": round(n / sr, 3), "sample_rate": sr, "channels": processed.shape[0], "codec": "flac",
        "bit_depth": 24, "derived_from": src["id"], "original_pair_id": segment["id"], "cache_key": job["cache_key"],
        "peaks_key": _upload_peaks(ctx, processed, out_key, 800), "analysis": stats, "warnings": warnings,
        "expires_at": now_iso(retention),
    })
    return out["id"]


# ---------------------------------------------------------------------------
# RENDER — arquivo completo no formato de download
# ---------------------------------------------------------------------------
def _safe_name(s: str) -> str:
    keep = "".join(c if c.isalnum() or c in " -_()%." else "_" for c in s).strip()
    return keep[:120] or "audio"


def run_render(ctx: JobContext) -> str:
    job = ctx.job
    src = ctx.file(job["source_file_id"])
    params = job.get("params") or {}
    fmt = params.get("format") or "wav"
    chain, preset_name = ctx.chain()
    retention = timedelta(days=int(setting(ctx.settings, "retention_render_days", 3)))

    ctx.progress(5, "Preparando áudio…")
    local = ctx.storage.cached_source(src["storage_key"])
    audio, sr = decode(local)
    n = audio.shape[1]
    ctx.progress(20, "Processando…")
    processed = run_chain(audio, sr, chain, int(job["intensity"]),
                          on_step=lambda i, t: ctx.progress(20 + int(60 * i / t), "Processando…")) if chain else audio
    ctx.progress(82, "Verificando qualidade…")
    stats, warnings = _qc(processed, sr, n, bool((src.get("analysis") or {}).get("silent")))

    ctx.progress(90, "Finalizando…")
    bit_depth = 16 if (src.get("bit_depth") or 24) <= 16 else 24
    out_path = write_audio(ctx.tmp / f"render.{fmt}", processed, sr, fmt, bit_depth)
    track = ctx.db.select_one("tracks", {"id": f"eq.{job['track_id']}", "select": "name"}) if job.get("track_id") else None
    base = (track or {}).get("name") or Path(src.get("original_name") or "audio").stem
    label = f"{preset_name} {job['intensity']}%" if preset_name else "Original"
    file_name = _safe_name(f"{base} - {label}") + f".{fmt}"
    out_key = f"{_base_prefix(src)}/renders/{job['cache_key'][:32]}.{fmt}"
    size = ctx.storage.upload(out_path, out_key)
    out = _insert_output(ctx, {
        "user_id": src["user_id"], "project_id": src["project_id"], "kind": "render", "status": "ready",
        "storage_key": out_key, "original_name": file_name, "ext": fmt,
        "mime": "audio/mpeg" if fmt == "mp3" else "audio/wav", "size_bytes": size,
        "duration_s": round(n / sr, 3), "sample_rate": sr, "channels": processed.shape[0], "codec": fmt,
        "bit_depth": None if fmt == "mp3" else bit_depth, "derived_from": src["id"], "cache_key": job["cache_key"],
        "download_key": params.get("download_key"), "analysis": stats, "warnings": warnings,
        "expires_at": now_iso(retention),
    })
    return out["id"]


from .ai_lab import run_ai_stem_separate

HANDLERS = {
    "analyze": run_analyze,
    "preview": run_preview,
    "render": run_render,
    "ai_stem_separate": run_ai_stem_separate,
}


def execute(ctx: JobContext) -> None:
    job = ctx.job
    started = time.monotonic()
    fields = {"job_id": job["id"], "user_id": job["user_id"], "project_id": job.get("project_id"),
              "type": job["type"], "preset_version_id": job.get("preset_version_id"), "attempt": job.get("attempts")}
    try:
        handler = HANDLERS.get(job["type"])
        if not handler:
            raise JobError("UNSUPPORTED_JOB", f"Tipo de job não suportado: {job['type']}")
        output_id = handler(ctx)
        ms = int((time.monotonic() - started) * 1000)
        ctx.db.update("processing_jobs", {"id": f"eq.{job['id']}"}, {
            "status": "completed", "progress": 100, "stage": "Pronto", "output_file_id": output_id,
            "completed_at": now_iso(), "duration_ms": ms, "error_code": None, "error_message": None,
        })
        if job.get("project_id") and job["type"] != "analyze":
            ctx.db.update("projects", {"id": f"eq.{job['project_id']}"}, {"last_processed_at": now_iso()})
        log.info("job concluído", extra={"fields": fields | {"status": "completed", "duration_ms": ms}})
    except (JobError, ChainError, AudioError) as exc:
        code = getattr(exc, "code", "CHAIN_ERROR" if isinstance(exc, ChainError) else "INVALID_AUDIO")
        _fail(ctx, code, str(exc), fields, started)
    except Exception as exc:  # noqa: BLE001 — registra e segue para o próximo job
        log.exception("erro inesperado no job", extra={"fields": fields})
        _fail(ctx, "INTERNAL_ERROR", "Ocorreu um erro inesperado no processamento. Tente novamente.", fields,
              started, detail=repr(exc))
    finally:
        ctx.cleanup()


def _fail(ctx: JobContext, code: str, message: str, fields: dict[str, Any], started: float,
          detail: str | None = None) -> None:
    ms = int((time.monotonic() - started) * 1000)
    try:
        ctx.db.update("processing_jobs", {"id": f"eq.{ctx.job['id']}"}, {
            "status": "failed", "stage": "Falhou", "error_code": code, "error_message": message,
            "completed_at": now_iso(), "duration_ms": ms,
        })
    except DbError:
        log.exception("não foi possível marcar job como falho", extra={"fields": fields})
    log.warning("job falhou", extra={"fields": fields | {"status": "failed", "error": code, "detail": detail or message,
                                                        "duration_ms": ms}})
