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
# tarefa do ACE-Step que completa a música a partir da guia ("complete"; "cover" refaz a produção inteira seguindo a guia)
ACESTEP_TASK = os.environ.get("ACESTEP_TASK", "complete")
# força do "cover": quanto a estrutura da guia (melodia, harmonia, tempo) pesa na nova produção (0–1)
COVER_STRENGTH = float(os.environ.get("ACESTEP_COVER_STRENGTH", "0.6"))

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


# instrumentos que o "complete" acrescenta, por estilo (nomes do ACE-Step; nunca "vocals": a voz é a da pessoa)
GENRE_TRACKS = {
    "worship": ["drums", "bass", "keyboard", "guitar", "synth", "strings"],
    "gospel": ["drums", "bass", "keyboard", "guitar", "brass"],
    "sertanejo": ["drums", "bass", "guitar", "keyboard"],
    "pagode": ["percussion", "drums", "bass", "guitar", "keyboard"],
    "funk": ["drums", "bass", "synth", "percussion"],
    "pop": ["drums", "bass", "keyboard", "guitar", "synth"],
    "pop_us": ["drums", "bass", "keyboard", "synth", "guitar"],
    "rock": ["drums", "bass", "guitar", "keyboard"],
    "trap": ["drums", "bass", "synth", "keyboard"],
    "acoustic": ["guitar", "keyboard", "percussion", "strings", "bass"],
    "edm": ["drums", "bass", "synth", "fx"],
    "lofi": ["drums", "bass", "keyboard", "fx"],
    "mpb": ["guitar", "keyboard", "percussion", "bass", "strings"],
}


def task_fields(task, genre):
    """Campos extras de cada tarefa. A instrução explícita evita o genérico "Complete the input track:"."""
    if task == "complete":
        tracks = GENRE_TRACKS.get(genre, GENRE_TRACKS["pop"])
        return {"instruction": f"Complete the input track with {', '.join(tracks)}:"}
    if task == "cover":
        return {"audio_cover_strength": str(COVER_STRENGTH)}
    return {}


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
            task = str(body.get("task") or ACESTEP_TASK)
            for seed, out in zip(seeds, outs):
                try:
                    audio = self._one(guide, ref, seed, task, genre, prompt, body)
                except RuntimeError as e:
                    return {"ok": False, "error": str(e)}
                up = httpx.put(out, content=audio, headers={"Content-Type": "audio/wav"}, timeout=300)
                if up.status_code >= 300:
                    return {"ok": False, "error": f"upload_{up.status_code}"}
        return {"ok": True}


    def _one(self, guide, ref, seed, task, genre, prompt, body) -> bytes:
        """Uma geração no servidor do ACE-Step; devolve o WAV."""
        import json

        import httpx

        if task not in ("complete", "cover"):
            task = "complete"
        files = {"src_audio": open(guide, "rb")}
        if ref:
            files["reference_audio"] = open(ref, "rb")
        data = {
            **task_fields(task, genre),
            "task_type": task,
            "vocal_language": "pt",
            "prompt": prompt,
            "lyrics": str(body.get("lyrics") or "")[:2000],
            "bpm": str(int(round(float(body.get("bpm") or 90)))),
            "key_scale": key_to_acestep(body.get("key")),
            "audio_duration": str(min(600, max(10, float(body.get("duration_s") or 180)))),
            "seed": str(int(seed)),
            "use_random_seed": "false",
            "inference_steps": "48",
            "batch_size": "1",
            "audio_format": "wav",
        }
        with httpx.Client(base_url="http://127.0.0.1:8001", timeout=600) as api:
            try:
                task_id = api.post("/release_task", data=data, files=files).json()["data"]["task_id"]
            finally:
                for f in files.values():
                    f.close()
            for _ in range(900):
                q = api.post("/query_result", json={"task_id_list": [task_id]}).json()["data"][0]
                if q["status"] == 1:
                    break
                if q["status"] == 2:
                    raise RuntimeError("generation_failed")
                time.sleep(1)
            else:
                raise RuntimeError("generation_timeout")
            result = json.loads(q["result"])
            item = result[0] if isinstance(result, list) else result
            return api.get(item["file"]).content

    @modal.method()
    def teste(self, guide_bytes: bytes, ref_bytes: bytes | None, body: dict) -> bytes:
        """Usado pelo `modal run` abaixo (teste A/B sem passar pelo app). Recorta e converte aqui (o contêiner tem FFmpeg)."""

        def to_wav(raw, path, start, dur):
            src = path + ".in"
            with open(src, "wb") as f:
                f.write(raw)
            subprocess.run(["ffmpeg", "-v", "error", "-y", "-ss", str(start), "-t", str(dur), "-i", src, "-ac", "2", "-ar", "44100", path], check=True)

        with tempfile.TemporaryDirectory() as d:
            guide = os.path.join(d, "guia.wav")
            to_wav(guide_bytes, guide, body.get("start", 0), body.get("duration_s", 30))
            ref = None
            if ref_bytes:
                ref = os.path.join(d, "ref.wav")
                to_wav(ref_bytes, ref, 30, 60)
            genre = str(body.get("genre", "pop"))
            prompt = ", ".join(p for p in [GENRE_PROMPT.get(genre, ""), str(body.get("style", ""))[:200]] if p)
            return self._one(guide, ref, int(body.get("seed", 1)), str(body["task"]), genre, prompt, body)


@app.local_entrypoint()
def ab(guia: str, estilo: str = "gospel", bpm: float = 0, tom: str = "", inicio: float = 0, segundos: float = 30, referencia: str = "", saida: str = "teste-ab"):
    """
    Teste A/B a partir do seu computador:
      modal run infra/modal/acestep_app.py --guia "minha guia.mp3" --estilo gospel --bpm 116 --tom "Sol menor" --inicio 133
    Gera 2 versões com "complete" e 2 com "cover" do trecho escolhido e salva em teste-ab/.
    """
    import pathlib

    out = pathlib.Path(saida)
    out.mkdir(exist_ok=True)
    g = pathlib.Path(guia).read_bytes()
    r = pathlib.Path(referencia).read_bytes() if referencia else None
    c = Composer()
    jobs = []
    for task in ("complete", "cover"):
        for seed in (11, 22):
            body = {"task": task, "seed": seed, "genre": estilo, "bpm": bpm or None, "key": tom or None, "duration_s": segundos, "start": inicio}
            jobs.append((f"{task}-{seed}.wav", c.teste.spawn(g, r, body)))
    for name, job in jobs:
        (out / name).write_bytes(job.get())
        print("salvo", out / name)


def key_to_acestep(key):
    """'Ré maior' → 'D Major'; 'Lá menor' → 'A Minor'."""
    if not key:
        return ""
    names = {"Dó": "C", "Ré": "D", "Mi": "E", "Fá": "F", "Sol": "G", "Lá": "A", "Si": "B"}
    parts = str(key).split()
    root = parts[0]
    acc = "#" if root.endswith("#") else ("b" if len(root) > 1 and root.endswith("b") and root[:-1] in names else "")
    base = names.get(root.rstrip("#b") if acc else root, root.rstrip("#b") if acc else root)
    mode = "Minor" if len(parts) > 1 and parts[-1].startswith("menor") else "Major"
    return f"{base}{acc} {mode}"
