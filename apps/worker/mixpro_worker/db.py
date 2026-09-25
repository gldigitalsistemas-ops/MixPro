"""Cliente mínimo do PostgREST (Supabase) usando a service role key.

O worker só precisa de HTTPS de saída: nenhuma porta aberta, nenhuma senha de
banco. Funciona igual no PC local, numa VPS ou em vários workers.
"""

from __future__ import annotations

from typing import Any

import httpx


class DbError(RuntimeError):
    pass


class Db:
    def __init__(self, url: str, key: str, timeout: float = 30.0) -> None:
        headers = {"apikey": key, "Content-Type": "application/json"}
        # Chaves legadas são JWT; as novas (sb_secret_…) vão só no header apikey.
        if key.startswith("eyJ"):
            headers["Authorization"] = f"Bearer {key}"
        self._http = httpx.Client(base_url=f"{url}/rest/v1", headers=headers, timeout=timeout)

    def close(self) -> None:
        self._http.close()

    def _check(self, r: httpx.Response) -> Any:
        if r.status_code >= 300:  # 300 = embed ambíguo no PostgREST
            raise DbError(f"{r.request.method} {r.request.url.path} → {r.status_code}: {r.text[:500]}")
        if r.status_code == 204 or not r.content:
            return None
        return r.json()

    def rpc(self, fn: str, args: dict[str, Any] | None = None) -> Any:
        return self._check(self._http.post(f"/rpc/{fn}", json=args or {}))

    def select(self, table: str, params: dict[str, str]) -> list[dict[str, Any]]:
        return self._check(self._http.get(f"/{table}", params=params)) or []

    def select_one(self, table: str, params: dict[str, str]) -> dict[str, Any] | None:
        rows = self.select(table, {**params, "limit": "1"})
        return rows[0] if rows else None

    def insert(self, table: str, row: dict[str, Any]) -> dict[str, Any]:
        r = self._http.post(f"/{table}", json=row, headers={"Prefer": "return=representation"})
        return self._check(r)[0]

    def update(self, table: str, match: dict[str, str], values: dict[str, Any]) -> list[dict[str, Any]]:
        r = self._http.patch(f"/{table}", params=match, json=values, headers={"Prefer": "return=representation"})
        return self._check(r) or []

    def delete(self, table: str, match: dict[str, str]) -> None:
        self._check(self._http.delete(f"/{table}", params=match))

    def settings(self) -> dict[str, Any]:
        rows = self.select("system_settings", {"select": "key,value"})
        return {r["key"]: r["value"] for r in rows}
