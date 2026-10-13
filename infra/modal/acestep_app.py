"""
Mix Pro — gerador de bases (Produção da composição) em GPU no Modal, com o ACE-Step 1.5 (licença MIT).

O serviço de processamento do Mix Pro chama este endpoint com:
  { guide_url, reference_url, output_urls[], seeds[], genre, style, bpm, key, duration_s }
O endpoint baixa a voz da guia (e a referência) pelas URLs temporárias do nosso R2, gera uma base por
semente e grava cada uma (WAV) na URL de gravação correspondente. Nada fica guardado aqui.

Implantação (uma vez):
  pip install modal
  modal setup                                   # entra na conta do Modal
  modal secret create mixpro-compose COMPOSE_TOKEN=<um segredo longo e aleatório>
  modal deploy infra/modal/acestep_app.py       # imprime a URL do endpoint (COMPOSE_URL)

Custo: GPU A10 (24 GB) por segundo de uso, desliga sozinha quando ociosa (scaledown_window).
"""

from __future__ import annotations

import asyncio
import os
import subprocess
import tempfile
import time

import modal

ACESTEP_REPO = "https://github.com/ACE-Step/ACE-Step-1.5.git"
# commit travado depois de testado (troque ao atualizar o modelo); "main" só para a primeira implantação
ACESTEP_REF = os.environ.get("ACESTEP_REF", "main")
# tarefa do ACE-Step que completa a música a partir da voz ("complete"; "lego" adiciona camadas)
ACESTEP_TASK = os.environ.get("ACESTEP_TASK", "complete")

image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("git", "ffmpeg", "curl")
    .pip_install("uv", "httpx==0.27.2", "fastapi[standard]==0.115.6")
    .run_commands(
        f"git clone {ACESTEP_REPO} /opt/acestep && cd /opt/acestep && git checkout {ACESTEP_REF}",
        "cd /opt/acestep && uv sync",
    )
    .env(
        {
            # modelo base (as tarefas "complete" e "lego" só existem nele) + LM de 1,7B
            "ACESTEP_CONFIG_PATH": "acestep-v15-base",
            "ACESTEP_LM_MODEL_PATH": "acestep-5Hz-lm-1.7B",
            "HF_HOME": "/models",
        }
    )
)

with image.imports():
    from fastapi import HTTPException, Request

models = modal.Volume.from_name("mixpro-acestep-models", create_if_missing=True)
app = modal.App("mixpro-compose", image=image)

GENRE_PROMPT = {
    "worship": "modern worship, atmospheric pads, ambient electric guitars with delay, warm bass, emotional build-ups, live drums",
    "gospel": "brazilian gospel, piano and organ, live drums, groovy bass, uplifting",
    "sertanejo": "brazilian sertanejo, steel-string acoustic guitar, accordion, bass, pop drums, radio production",
    "pagode": "brazilian pagode samba, cavaquinho, pandeiro, tantã, surdo, banjo, warm bass",
    "funk": "brazilian funk carioca, heavy 808 bass, tamborzão beat, punchy",
    "pop": "modern pop production, punchy drums, synths and guitars, polished",
    "pop_us": "modern american pop, punchy drums, bright synths, polished radio production",
    "rock": "rock band, distorted electric guitars, live drums, bass guitar, energetic",
    "trap": "trap beat, 808 bass, crisp hi-hats, dark pads",
    "acoustic": "acoustic arrangement, acoustic guitar, piano, light percussion, intimate",
    "edm": "edm, big synths, four on the floor, risers and drops",
    "lofi": "lofi hip hop, warm keys, dusty drums, vinyl texture",
    "mpb": "mpb, brazilian popular music, nylon guitar, piano, soft percussion",
}


@app.cls(gpu="A10", timeout=1800, scaledown_window=120, volumes={"/models": models}, secrets=[modal.Secret.from_name("mixpro-compose")])
class Composer:
    @modal.enter()
    def start(self):
        # sobe o servidor REST do próprio ACE-Step dentro do contêiner e espera ficar pronto
        self.proc = subprocess.Popen(["uv", "run", "acestep-api"], cwd="/opt/acestep", env={**os.environ, "PORT": "8001"})
        import httpx

        for _ in range(600):
            try:
                httpx.get("http://127.0.0.1:8001/", timeout=2)
                break
            except Exception:
                time.sleep(1)

    @modal.exit()
    def stop(self):
        self.proc.terminate()

    @modal.fastapi_endpoint(method="POST")
    async def generate(self, request: Request):
        token = os.environ.get("COMPOSE_TOKEN", "")
        if not token or request.headers.get("authorization", "") != f"Bearer {token}":
            raise HTTPException(status_code=401, detail="unauthorized")
        body = await request.json()
        return await asyncio.to_thread(self._run, body)

    def _run(self, body: dict) -> dict:
        import httpx

        outs = body.get("output_urls") or []
        seeds = body.get("seeds") or []
        if not outs or len(outs) != len(seeds) or len(outs) > 8:
            return {"ok": False, "error": "bad_request"}
        genre = str(body.get("genre", "pop"))
        style = str(body.get("style", ""))[:200]
        prompt = ", ".join(p for p in [GENRE_PROMPT.get(genre, ""), style] if p)
        with tempfile.TemporaryDirectory() as d:
            guide = os.path.join(d, "guia.wav")
            with httpx.stream("GET", body["guide_url"], timeout=120) as r:
                r.raise_for_status()
                with open(guide, "wb") as f:
                    for c in r.iter_bytes():
                        f.write(c)
            ref = None
            if body.get("reference_url"):
                ref = os.path.join(d, "ref.wav")
                with httpx.stream("GET", body["reference_url"], timeout=120) as r:
                    r.raise_for_status()
                    with open(ref, "wb") as f:
                        for c in r.iter_bytes():
                            f.write(c)
            with httpx.Client(base_url="http://127.0.0.1:8001", timeout=600) as api:
                for seed, out in zip(seeds, outs):
                    files = {"src_audio": open(guide, "rb")}
                    if ref:
                        files["reference_audio"] = open(ref, "rb")
                    data = {
                        "task_type": ACESTEP_TASK,
                        "prompt": prompt,
                        "bpm": str(int(round(float(body.get("bpm") or 90)))),
                        "key_scale": key_to_acestep(body.get("key")),
                        "audio_duration": str(min(600, max(10, float(body.get("duration_s") or 180)))),
                        "seed": str(int(seed)),
                        "use_random_seed": "false",
                        "inference_steps": "48",
                        "batch_size": "1",
                        "audio_format": "wav",
                    }
                    task = api.post("/release_task", data=data, files=files).json()["data"]["task_id"]
                    for f in files.values():
                        f.close()
                    for _ in range(600):
                        q = api.post("/query_result", json={"task_id_list": [task]}).json()["data"][0]
                        if q["status"] == 1:
                            break
                        if q["status"] == 2:
                            return {"ok": False, "error": "generation_failed"}
                        time.sleep(1)
                    import json

                    result = json.loads(q["result"])
                    item = result[0] if isinstance(result, list) else result
                    audio = api.get(item["file"]).content
                    up = httpx.put(out, content=audio, headers={"Content-Type": "audio/wav"}, timeout=300)
                    if up.status_code >= 300:
                        return {"ok": False, "error": f"upload_{up.status_code}"}
        return {"ok": True}


def key_to_acestep(key):
    """'Ré maior' → 'D Major'; 'Lá menor' → 'A Minor'."""
    if not key:
        return ""
    names = {"Dó": "C", "Ré": "D", "Mi": "E", "Fá": "F", "Sol": "G", "Lá": "A", "Si": "B"}
    parts = str(key).split()
    root = parts[0]
    sharp = root.endswith("#")
    base = names.get(root.rstrip("#b"), root.rstrip("#b"))
    mode = "Minor" if len(parts) > 1 and parts[-1].startswith("menor") else "Major"
    return f"{base}{'#' if sharp else ''} {mode}"
