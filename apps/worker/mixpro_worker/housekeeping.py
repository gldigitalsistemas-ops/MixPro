"""Manutenção do armazenamento: mantém o custo baixo sem afetar o usuário.

- Previews/trechos e renders são regeneráveis → apagados após N dias sem acesso.
  (Re-download de um render apagado é regenerado e NÃO cobra de novo.)
- Uploads abandonados (> 24h em "uploading") são removidos.
- Projetos excluídos têm todos os arquivos apagados e depois o registro.
"""

from __future__ import annotations

import logging
from datetime import timedelta
from typing import Any

from .db import Db
from .jobs import now_iso, setting
from .storage import Storage

log = logging.getLogger("mixpro.housekeeping")
BATCH = 200


def _expire(db: Db, storage: Storage, kinds: str, days: int) -> int:
    rows = db.select("audio_files", {
        "select": "id,storage_key,peaks_key", "kind": f"in.({kinds})", "deleted_at": "is.null",
        "last_accessed_at": f"lt.{now_iso(timedelta(days=-days))}", "limit": str(BATCH),
    })
    for r in rows:
        storage.delete(r["storage_key"])
        if r.get("peaks_key"):
            storage.delete(r["peaks_key"])
        db.update("audio_files", {"id": f"eq.{r['id']}"}, {"status": "deleted", "deleted_at": now_iso()})
    return len(rows)


def run(db: Db, storage: Storage, settings: dict[str, Any]) -> dict[str, int]:
    stats = {
        "previews": _expire(db, storage, "segment,preview", int(setting(settings, "retention_preview_days", 7))),
        "renders": _expire(db, storage, "render,mix", int(setting(settings, "retention_render_days", 3))),
        "abandoned_uploads": 0,
        "projects": 0,
    }

    for r in db.select("audio_files", {"select": "id,storage_key", "status": "eq.uploading",
                                       "created_at": f"lt.{now_iso(timedelta(days=-1))}", "limit": str(BATCH)}):
        storage.delete(r["storage_key"])
        db.delete("audio_files", {"id": f"eq.{r['id']}"})
        stats["abandoned_uploads"] += 1

    for p in db.select("projects", {"select": "id,user_id", "deleted_at": "not.is.null", "limit": "50"}):
        storage.delete_prefix(f"users/{p['user_id']}/projects/{p['id']}/")
        db.delete("projects", {"id": f"eq.{p['id']}"})
        stats["projects"] += 1

    storage.purge_cache_older_than(7 * 86400)
    if any(stats.values()):
        log.info("limpeza concluída", extra={"fields": stats})
    return stats
