"""
Teste 2 do MiniMax Music Cover: prompts montados pela análise da referência e da guia (idioma, voz, tom, andamento),
e, se houver chave da Runware, a letra transcrita da guia junto (é o que corrige a pronúncia).

  python infra/compose-test/teste_minimax2.py "guia.mp3" infra/compose-test/prompts.json

prompts.json: [{"nome": "...", "prompt": "... (até 300 caracteres)", "letra": "opcional, com [Verse]/[Chorus]"}]
Chaves (variáveis de ambiente do usuário): WAVESPEED_API_KEY (sem letra) e/ou RUNWARE_API_KEY (com letra).
Custo: US$ 0,15 por versão. Salva em teste-minimax2/.
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


def env(name):
    v = os.environ.get(name, "").strip()
    if not v and os.name == "nt":
        # chave gravada com setx (variável do usuário) sem reabrir o terminal
        import winreg

        try:
            with winreg.OpenKey(winreg.HKEY_CURRENT_USER, "Environment") as k:
                v = str(winreg.QueryValueEx(k, name)[0]).strip()
        except OSError:
            v = ""
    return v


WS = env("WAVESPEED_API_KEY")
RW = env("RUNWARE_API_KEY")


def call(method, url, key, body=None, headers=None):
    req = urllib.request.Request(url, data=body, method=method, headers={"Authorization": f"Bearer {key}", **(headers or {})})
    try:
        with urllib.request.urlopen(req, timeout=600) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError as e:
        raise RuntimeError(f"Erro {e.code} em {url}: {e.read().decode(errors='replace')[:600]}")


def upload_ws(path):
    raw = path.read_bytes()
    mime = mimetypes.guess_type(path.name)[0] or "audio/mpeg"
    b = uuid.uuid4().hex
    body = (f"--{b}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"guia{path.suffix}\"\r\nContent-Type: {mime}\r\n\r\n").encode() + raw + f"\r\n--{b}--\r\n".encode()
    try:
        r = call("POST", "https://api.wavespeed.ai/api/v3/media/upload/binary", WS, body, {"Content-Type": f"multipart/form-data; boundary={b}"})
        url = (r.get("data") or r).get("download_url")
        if url:
            return url
    except RuntimeError as e:
        print("upload direto falhou, enviando embutido:", e)
    return f"data:{mime};base64,{base64.b64encode(raw).decode()}"


def wavespeed(audio, prompt):
    r = call("POST", "https://api.wavespeed.ai/api/v3/minimax/music-cover", WS, json.dumps({"prompt": prompt, "audio": audio}).encode(), {"Content-Type": "application/json"})
    tid = (r.get("data") or r)["id"]
    t0 = time.time()
    while time.time() - t0 < 900:
        time.sleep(5)
        r = call("GET", f"https://api.wavespeed.ai/api/v3/predictions/{tid}/result", WS)
        r = r.get("data") or r
        if r.get("status") == "completed":
            return r["outputs"][0]
        if r.get("status") in ("failed", "cancelled", "timeout", "deleted"):
            raise RuntimeError(f"falhou: {r.get('error')}")
    raise RuntimeError("demorou mais de 15 min")


def runware(audio, prompt, lyrics):
    task = {
        "taskType": "audioInference",
        "taskUUID": str(uuid.uuid4()),
        "model": "minimax:music@cover",
        "positivePrompt": prompt,
        "inputs": {"audio": audio},
        "outputType": "URL",
        "outputFormat": "MP3",
        "audioSettings": {"bitrate": 256, "channels": 2, "sampleRate": 44100},
        "numberResults": 1,
        "deliveryMethod": "sync",
    }
    if lyrics:
        task["settings"] = {"lyrics": lyrics[:1000]}
    r = call("POST", "https://api.runware.ai/v1", RW, json.dumps([task]).encode(), {"Content-Type": "application/json"})
    if r.get("errors"):
        raise RuntimeError(json.dumps(r["errors"])[:600])
    item = r["data"][0]
    return item.get("audioURL") or item.get("audioUrl") or item.get("url")


def main():
    if len(sys.argv) < 3:
        raise SystemExit(__doc__)
    if not WS and not RW:
        raise SystemExit("Defina WAVESPEED_API_KEY e/ou RUNWARE_API_KEY.")
    guia = pathlib.Path(sys.argv[1])
    prompts = json.loads(pathlib.Path(sys.argv[2]).read_text(encoding="utf-8"))
    out = pathlib.Path("teste-minimax2")
    out.mkdir(exist_ok=True)
    audio = upload_ws(guia) if WS else f"data:audio/mpeg;base64,{base64.b64encode(guia.read_bytes()).decode()}"
    print("guia enviada")
    from concurrent.futures import ThreadPoolExecutor

    def one(p):
        t0 = time.time()
        if p.get("letra") and not RW:
            return f"{p['nome']}: pulada (a letra só vai pela Runware; defina RUNWARE_API_KEY)"
        try:
            if p.get("letra") and RW:
                url = runware(audio, p["prompt"], p["letra"])
            elif WS:
                url = wavespeed(audio, p["prompt"])
            else:
                url = runware(audio, p["prompt"], None)
            dest = out / f"{p['nome']}.mp3"
            with urllib.request.urlopen(url, timeout=300) as f:
                dest.write_bytes(f.read())
            return f"salvo {dest} ({time.time() - t0:.0f} s)"
        except RuntimeError as e:
            return f"{p['nome']}: {e}"

    with ThreadPoolExecutor(4) as ex:
        for msg in ex.map(one, prompts):
            print(msg)


if __name__ == "__main__":
    main()
