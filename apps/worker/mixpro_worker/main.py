"""Loop principal do worker: heartbeat, captura de jobs, execução e manutenção."""

from __future__ import annotations

import json
import logging
import platform
import signal
import threading
import time
from typing import Any

from . import __version__, housekeeping
from .config import Config
from .db import Db, DbError
from .jobs import JobContext, execute, now_iso
from .pro_sync import sync_pro_stems
from .storage import Storage

log = logging.getLogger("mixpro.worker")


class JsonFormatter(logging.Formatter):
    """Logs estruturados (uma linha JSON por evento)."""

    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, Any] = {
            "ts": self.formatTime(record, "%Y-%m-%dT%H:%M:%S"),
            "level": record.levelname.lower(),
            "logger": record.name,
            "msg": record.getMessage(),
        }
        payload |= getattr(record, "fields", {}) or {}
        if record.exc_info:
            payload["exc"] = self.formatException(record.exc_info)
        return json.dumps(payload, ensure_ascii=False, default=str)


class Worker:
    def __init__(self, cfg: Config) -> None:
        self.cfg = cfg
        self.db = Db(cfg.supabase_url, cfg.supabase_key)
        self.hb_db = Db(cfg.supabase_url, cfg.supabase_key)  # cliente separado p/ a thread de heartbeat
        self.storage = Storage(cfg.s3_endpoint, cfg.s3_region, cfg.s3_bucket, cfg.s3_access_key,
                               cfg.s3_secret_key, cfg.work_dir, cfg.source_cache_mb)
        self.stop = threading.Event()
        self.current_job: str | None = None
        self.settings: dict[str, Any] = {}
        self.settings_at = 0.0

    # ------------------------------------------------------------------ heartbeat
    def _heartbeat_loop(self) -> None:
        caps = {"jobs": ["analyze", "preview", "render", "ai_stem_separate"], "python": platform.python_version()}
        while not self.stop.is_set():
            try:
                self.hb_db.rpc("worker_heartbeat", {"p_worker": self.cfg.worker_id, "p_hostname": platform.node(),
                                                    "p_version": __version__, "p_capabilities": caps})
                if self.current_job:
                    self.hb_db.update("processing_jobs", {"id": f"eq.{self.current_job}"}, {"heartbeat_at": now_iso()})
            except Exception:  # noqa: BLE001
                log.warning("falha no heartbeat", exc_info=True)
            self.stop.wait(15)

    def _refresh_settings(self) -> dict[str, Any]:
        if time.monotonic() - self.settings_at > 60:
            self.settings = self.db.settings()
            self.settings_at = time.monotonic()
        return self.settings

    # ------------------------------------------------------------------ loop
    def run(self) -> None:
        log.info("worker iniciado", extra={"fields": {"worker_id": self.cfg.worker_id, "version": __version__}})
        threading.Thread(target=self._heartbeat_loop, daemon=True).start()
        idle = self.cfg.poll_min_s
        last_housekeeping = 0.0
        while not self.stop.is_set():
            try:
                settings = self._refresh_settings()
                if time.monotonic() - last_housekeeping > 60:
                    last_housekeeping = time.monotonic()
                    if self.db.rpc("try_worker_lock", {"p_name": "housekeeping", "p_worker": self.cfg.worker_id,
                                                       "p_interval_s": self.cfg.housekeeping_interval_s}):
                        housekeeping.run(self.db, self.storage, settings)
                        synced = sync_pro_stems(self.cfg, self.db, self.storage)
                        if synced:
                            log.info("stems profissionais sincronizados", extra={"fields": {"count": synced}})

                rows = self.db.rpc("claim_job", {"p_worker": self.cfg.worker_id})
                if not rows:
                    self.stop.wait(idle)
                    idle = min(idle * 1.5, self.cfg.poll_max_s)
                    continue
                idle = self.cfg.poll_min_s
                job = rows[0]
                self.current_job = job["id"]
                try:
                    execute(JobContext(self.db, self.storage, job, settings, self.cfg.work_dir))
                finally:
                    self.current_job = None
            except DbError:
                log.warning("erro de comunicação com o banco; tentando novamente", exc_info=True)
                self.stop.wait(self.cfg.poll_max_s)
            except Exception:  # noqa: BLE001
                log.exception("erro no loop do worker")
                self.stop.wait(self.cfg.poll_max_s)
        log.info("worker encerrado")


def main() -> None:
    handler = logging.StreamHandler()
    handler.setFormatter(JsonFormatter())
    logging.basicConfig(level=logging.INFO, handlers=[handler])
    for noisy in ("httpx", "httpcore", "botocore", "boto3", "s3transfer", "numba"):
        logging.getLogger(noisy).setLevel(logging.WARNING)
    worker = Worker(Config.from_env())

    def _graceful(signum: int, _frame: Any) -> None:
        log.info("sinal recebido; encerrando após o job atual", extra={"fields": {"signal": signum}})
        worker.stop.set()

    signal.signal(signal.SIGINT, _graceful)
    signal.signal(signal.SIGTERM, _graceful)
    worker.run()


if __name__ == "__main__":
    main()
