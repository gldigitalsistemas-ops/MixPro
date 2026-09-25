"""Object storage S3-compatível (Cloudflare R2, MinIO, AWS S3, Supabase S3).

Também mantém um cache local de originais para não baixar o mesmo arquivo a
cada preview (LRU por tamanho em disco).
"""

from __future__ import annotations

import os
import shutil
import time
from pathlib import Path

import boto3
from botocore.config import Config as BotoConfig
from botocore.exceptions import ClientError

CONTENT_TYPES = {
    ".wav": "audio/wav",
    ".flac": "audio/flac",
    ".mp3": "audio/mpeg",
    ".aiff": "audio/aiff",
    ".aif": "audio/aiff",
    ".json": "application/json",
}


class Storage:
    def __init__(self, endpoint: str, region: str, bucket: str, access_key: str, secret_key: str,
                 cache_dir: Path, cache_limit_mb: int) -> None:
        self.bucket = bucket
        self.s3 = boto3.client(
            "s3",
            endpoint_url=endpoint,
            region_name=region,
            aws_access_key_id=access_key,
            aws_secret_access_key=secret_key,
            config=BotoConfig(signature_version="s3v4", retries={"max_attempts": 5, "mode": "standard"},
                              s3={"addressing_style": "path"}),
        )
        self.cache_dir = cache_dir / "sources"
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        self.cache_limit = cache_limit_mb * 1024 * 1024

    def upload(self, local: Path, key: str, content_type: str | None = None) -> int:
        ctype = content_type or CONTENT_TYPES.get(local.suffix.lower(), "application/octet-stream")
        self.s3.upload_file(str(local), self.bucket, key, ExtraArgs={"ContentType": ctype})
        return local.stat().st_size

    def upload_bytes(self, data: bytes, key: str, content_type: str) -> None:
        self.s3.put_object(Bucket=self.bucket, Key=key, Body=data, ContentType=content_type)

    def download(self, key: str, local: Path) -> Path:
        local.parent.mkdir(parents=True, exist_ok=True)
        self.s3.download_file(self.bucket, key, str(local))
        return local

    def head_size(self, key: str) -> int | None:
        try:
            return int(self.s3.head_object(Bucket=self.bucket, Key=key)["ContentLength"])
        except ClientError:
            return None

    def delete(self, key: str) -> None:
        self.s3.delete_object(Bucket=self.bucket, Key=key)

    def delete_prefix(self, prefix: str) -> int:
        removed = 0
        paginator = self.s3.get_paginator("list_objects_v2")
        for page in paginator.paginate(Bucket=self.bucket, Prefix=prefix):
            objs = [{"Key": o["Key"]} for o in page.get("Contents", [])]
            if objs:
                self.s3.delete_objects(Bucket=self.bucket, Delete={"Objects": objs, "Quiet": True})
                removed += len(objs)
        return removed

    # ---- cache local de originais -------------------------------------------------
    def cached_source(self, key: str) -> Path:
        """Baixa (ou reaproveita) o original; a chave S3 é imutável por arquivo."""
        safe = key.replace("/", "__")
        local = self.cache_dir / safe
        if local.exists():
            os.utime(local, None)
            return local
        tmp = local.with_suffix(local.suffix + ".part")
        self.download(key, tmp)
        tmp.replace(local)
        self._evict()
        return local

    def put_cache(self, key: str, local: Path) -> None:
        """Guarda um arquivo recém-enviado no cache (evita baixá-lo de volta)."""
        shutil.copyfile(local, self.cache_dir / key.replace("/", "__"))
        self._evict()

    def _evict(self) -> None:
        files = sorted((p for p in self.cache_dir.iterdir() if p.is_file() and not p.name.endswith(".part")),
                       key=lambda p: p.stat().st_mtime)
        total = sum(p.stat().st_size for p in files)
        while files and total > self.cache_limit:
            victim = files.pop(0)
            total -= victim.stat().st_size
            victim.unlink(missing_ok=True)

    def purge_cache_older_than(self, seconds: float) -> None:
        limit = time.time() - seconds
        for p in self.cache_dir.iterdir():
            if p.is_file() and p.stat().st_mtime < limit:
                p.unlink(missing_ok=True)
