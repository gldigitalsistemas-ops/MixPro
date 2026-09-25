"""Configuração via variáveis de ambiente (nenhum caminho/SO fixo)."""

from __future__ import annotations

import os
import socket
import tempfile
from dataclasses import dataclass
from pathlib import Path


def _env(name: str, default: str | None = None, required: bool = False) -> str:
    value = os.environ.get(name, default)
    if required and not value:
        raise RuntimeError(f"Variável de ambiente obrigatória ausente: {name}")
    return value or ""


@dataclass(frozen=True)
class Config:
    supabase_url: str
    supabase_key: str
    s3_endpoint: str
    s3_region: str
    s3_bucket: str
    s3_access_key: str
    s3_secret_key: str
    worker_id: str
    work_dir: Path
    source_cache_mb: int
    poll_min_s: float
    poll_max_s: float
    housekeeping_interval_s: int
    # Sync de pedidos profissionais: pasta local onde os stems chegam
    pro_sync_dir: Path | None
    pro_sync_enabled: bool

    @staticmethod
    def from_env() -> "Config":
        work_dir = Path(_env("WORKER_WORK_DIR", str(Path(tempfile.gettempdir()) / "mixpro-worker")))
        work_dir.mkdir(parents=True, exist_ok=True)
        return Config(
            supabase_url=_env("SUPABASE_URL", required=True).rstrip("/"),
            supabase_key=_env("SUPABASE_SERVICE_ROLE_KEY", required=True),
            s3_endpoint=_env("S3_ENDPOINT", required=True),
            s3_region=_env("S3_REGION", "auto"),
            s3_bucket=_env("S3_BUCKET", required=True),
            s3_access_key=_env("S3_ACCESS_KEY_ID", required=True),
            s3_secret_key=_env("S3_SECRET_ACCESS_KEY", required=True),
            worker_id=_env("WORKER_ID", f"{socket.gethostname()}-{os.getpid()}"),
            work_dir=work_dir,
            source_cache_mb=int(_env("WORKER_SOURCE_CACHE_MB", "2048")),
            poll_min_s=float(_env("WORKER_POLL_MIN_S", "1")),
            poll_max_s=float(_env("WORKER_POLL_MAX_S", "5")),
            housekeeping_interval_s=int(_env("WORKER_HOUSEKEEPING_INTERVAL_S", "600")),
            pro_sync_dir=Path(_env("PRO_SYNC_DIR")) if _env("PRO_SYNC_DIR") else None,
            pro_sync_enabled=_env("PRO_SYNC_ENABLED", "true").lower() == "true",
        )
