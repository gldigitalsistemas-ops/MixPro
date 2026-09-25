"""
Sincronização de stems de pedidos profissionais para o PC/VPS do admin.

Fluxo:
  1. Busca stems com status='ready' e synced_at IS NULL.
  2. Baixa cada stem do R2 para <PRO_SYNC_DIR>/<order_id>/<file_name>.
  3. Marca synced_at = now() no banco.

O admin trabalha diretamente na pasta local. Quando terminar, usa o painel
admin para fazer upload da entrega (que vai para o R2) e muda o status do pedido.
"""

from __future__ import annotations

import logging
import shutil
from pathlib import Path

from .config import Config
from .db import Db
from .storage import Storage

log = logging.getLogger(__name__)


def sync_pro_stems(cfg: Config, db: Db, storage: Storage) -> int:
    """Baixa stems prontos que ainda não foram sincronizados. Retorna o número de stems baixados."""
    if not cfg.pro_sync_enabled or not cfg.pro_sync_dir:
        return 0

    sync_dir = cfg.pro_sync_dir
    sync_dir.mkdir(parents=True, exist_ok=True)

    # Busca stems prontos não sincronizados
    rows = db.select(
        "pro_stems",
        {
            "select": "id,order_id,storage_key,file_name",
            "status": "eq.ready",
            "synced_at": "is.null",
            "limit": "100",
        },
    )
    if not rows:
        return 0

    count = 0
    for stem in rows:
        order_id: str = stem["order_id"]
        stem_id: str = stem["id"]
        storage_key: str = stem["storage_key"]
        file_name: str = stem["file_name"]

        order_dir = sync_dir / order_id
        order_dir.mkdir(parents=True, exist_ok=True)
        dest = order_dir / file_name

        # Evita sobrescrever se já existe (idempotente)
        if dest.exists():
            db.update("pro_stems", {"synced_at": "now()"}, f"id=eq.{stem_id}")
            count += 1
            continue

        tmp = dest.with_suffix(dest.suffix + ".part")
        try:
            storage.download(storage_key, tmp)
            tmp.replace(dest)
            db.update("pro_stems", {"id": f"eq.{stem_id}"}, {"synced_at": "now()"})
            log.info("stem sincronizado order=%s file=%s", order_id, file_name)
            count += 1
        except Exception as exc:
            log.error("erro ao sincronizar stem %s: %s", stem_id, exc)
            tmp.unlink(missing_ok=True)

    return count


def upload_delivery(
    cfg: Config,
    db: Db,
    storage: Storage,
    order_id: str,
    local_path: Path,
) -> str:
    """
    Faz upload da entrega do admin para o R2 e atualiza o pedido.
    Retorna a storage_key do arquivo entregue.
    Pode ser chamado por uma rota API de admin ou CLI.
    """
    dest_key = f"pro-orders/{order_id}/delivery/{local_path.name}"
    storage.upload(local_path, dest_key)
    db.update(
        "pro_orders",
        {"delivery_key": dest_key, "status": "waiting_revision"},
        f"id=eq.{order_id}",
    )
    log.info("entrega enviada order=%s key=%s", order_id, dest_key)
    return dest_key
