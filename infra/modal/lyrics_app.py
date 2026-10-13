"""
Mix Pro — letra e idioma da guia (Produção da composição) com o Whisper large-v3 (faster-whisper, licença MIT) no Modal.

Para que serve: o gerador (MiniMax Music Cover) canta a letra que recebe. Sem a letra escrita ele "ouve" a guia e
erra palavras e o idioma (o português sai com sotaque espanhol). Aqui o app descobre o idioma cantado e transcreve
a letra com as marcas de tempo, que viram a letra estruturada enviada ao gerador.

  modal deploy infra/modal/lyrics_app.py                      # endpoint (LYRICS_URL), mesmo segredo do compositor
  modal run infra/modal/lyrics_app.py --arquivo "guia.mp3"    # teste local: imprime idioma e letra

Custo: GPU T4 por segundo de uso (~10–20 s por música), desliga sozinha.
"""

from __future__ import annotations

import os
import tempfile

import modal

image = (
    # CUDA 12 + cuDNN 9: o que o CTranslate2 (motor do faster-whisper) exige na GPU
    modal.Image.from_registry("nvidia/cuda:12.4.1-cudnn-runtime-ubuntu22.04", add_python="3.11")
    .apt_install("ffmpeg")
    .pip_install("faster-whisper==1.1.1", "requests==2.32.3", "fastapi[standard]==0.115.6", "httpx==0.27.2")
    .env({"HF_HOME": "/models"})
)
models = modal.Volume.from_name("mixpro-whisper-models", create_if_missing=True)
app = modal.App("mixpro-lyrics", image=image)

with image.imports():
    from fastapi import HTTPException, Request


@app.cls(gpu="T4", timeout=900, scaledown_window=60, volumes={"/models": models}, secrets=[modal.Secret.from_name("mixpro-compose")])
class Lyrics:
    @modal.enter()
    def load(self):
        from faster_whisper import WhisperModel

        self.model = WhisperModel("large-v3", device="cuda", compute_type="float16", download_root="/models")

    def _run(self, path: str, language: str | None) -> dict:
        segs, info = self.model.transcribe(
            path,
            language=language or None,
            # o filtro de voz (VAD) do Whisper é feito para fala e descarta canto: fica desligado
            vad_filter=False,
            beam_size=5,
            condition_on_previous_text=False,
            no_speech_threshold=0.9,
        )
        out = [{"start": round(s.start, 2), "end": round(s.end, 2), "text": s.text.strip()} for s in segs if s.text.strip()]
        return {"language": info.language, "probability": round(info.language_probability, 3), "segments": out}

    @modal.method()
    def from_bytes(self, raw: bytes, language: str | None = None) -> dict:
        with tempfile.NamedTemporaryFile(suffix=".audio") as f:
            f.write(raw)
            f.flush()
            return self._run(f.name, language)

    @modal.fastapi_endpoint(method="POST")
    async def transcribe(self, request: Request):
        token = os.environ.get("COMPOSE_TOKEN", "")
        if not token or request.headers.get("authorization", "") != f"Bearer {token}":
            raise HTTPException(status_code=401, detail="unauthorized")
        body = await request.json()
        import httpx

        with tempfile.NamedTemporaryFile(suffix=".audio") as f:
            with httpx.stream("GET", body["audio_url"], timeout=120) as r:
                r.raise_for_status()
                for c in r.iter_bytes():
                    f.write(c)
            f.flush()
            return self._run(f.name, body.get("language"))


@app.local_entrypoint()
def main(arquivo: str, idioma: str = "", saida: str = ""):
    import json
    import pathlib

    r = Lyrics().from_bytes.remote(pathlib.Path(arquivo).read_bytes(), idioma or None)
    text = json.dumps(r, ensure_ascii=False, indent=1)
    if saida:
        pathlib.Path(saida).write_text(text, encoding="utf-8")
    print(text)
