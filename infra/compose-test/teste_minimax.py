"""
Teste real do MiniMax Music Cover (pela WaveSpeed): a guia vira uma música completa com voz de IA,
mantendo a melodia e a letra cantadas, no estilo pedido. Sem dependências (só Python).

  set WAVESPEED_API_KEY=sua-chave          (PowerShell: $env:WAVESPEED_API_KEY="sua-chave")
  python infra/compose-test/teste_minimax.py "Expressão de alegria bpm 155.mpeg"

Custo: US$ 0,15 por versão (2 versões = US$ 0,30). Cada uma leva ~3 minutos. Salva em teste-minimax/.
"""

import base64
import json
import mimetypes
import os
import pathlib
import sys
import time
import urllib.error
import urllib.request
import uuid

API = "https://api.wavespeed.ai/api/v3"
KEY = os.environ.get("WAVESPEED_API_KEY", "").strip()

ESTILOS = {
    "gospel": "Brazilian gospel worship, Portuguese vocals, emotional and joyful, piano, organ, live drums, groovy bass, "
    "electric guitar, uplifting choir backing vocals, modern polished production, 116 BPM",
    "referencia": "Funk pop with 80s retro groove, Portuguese vocals, talk box and synth bass, punchy drum machine, "
    "funky guitar stabs, brass hits, glossy modern production, party energy, 116 BPM",
}


def call(method, url, body=None, headers=None):
    req = urllib.request.Request(url, data=body, method=method, headers={"Authorization": f"Bearer {KEY}", **(headers or {})})
    try:
        with urllib.request.urlopen(req, timeout=300) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError as e:
        raise SystemExit(f"Erro {e.code} em {url}: {e.read().decode(errors='replace')[:500]}")


def upload(path):
    """Envia a guia para o armazenamento da WaveSpeed; se não der, manda embutida (data URI)."""
    raw = path.read_bytes()
    mime = mimetypes.guess_type(path.name)[0] or "audio/mpeg"
    b = uuid.uuid4().hex
    body = (f"--{b}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"guia{path.suffix}\"\r\nContent-Type: {mime}\r\n\r\n").encode() + raw + f"\r\n--{b}--\r\n".encode()
    try:
        r = call("POST", f"{API}/media/upload/binary", body, {"Content-Type": f"multipart/form-data; boundary={b}"})
        url = (r.get("data") or r).get("download_url")
        if url:
            return url
    except SystemExit as e:
        print("upload direto falhou, enviando embutido:", e)
    return f"data:{mime};base64,{base64.b64encode(raw).decode()}"


def main():
    if not KEY:
        raise SystemExit("Defina WAVESPEED_API_KEY (crie em https://wavespeed.ai → API Keys).")
    if len(sys.argv) < 2:
        raise SystemExit(__doc__)
    guia = pathlib.Path(sys.argv[1])
    out = pathlib.Path("teste-minimax")
    out.mkdir(exist_ok=True)
    audio = upload(guia)
    print("guia enviada")
    tasks = {}
    for nome, prompt in ESTILOS.items():
        r = call("POST", f"{API}/minimax/music-cover", json.dumps({"prompt": prompt, "audio": audio}).encode(), {"Content-Type": "application/json"})
        tasks[nome] = (r.get("data") or r)["id"]
        print("gerando", nome, tasks[nome])
    pending = dict(tasks)
    t0 = time.time()
    while pending and time.time() - t0 < 900:
        time.sleep(5)
        for nome, tid in list(pending.items()):
            r = call("GET", f"{API}/predictions/{tid}/result")
            r = r.get("data") or r
            if r.get("status") == "completed":
                url = r["outputs"][0]
                ext = pathlib.Path(url.split("?")[0]).suffix or ".mp3"
                dest = out / f"{nome}{ext}"
                with urllib.request.urlopen(url, timeout=300) as f:
                    dest.write_bytes(f.read())
                print("salvo", dest, f"({time.time() - t0:.0f} s)")
                del pending[nome]
            elif r.get("status") in ("failed", "cancelled", "timeout", "deleted"):
                print("falhou", nome, r.get("error"))
                del pending[nome]
    if pending:
        print("ainda processando depois de 15 min:", pending)


if __name__ == "__main__":
    main()
