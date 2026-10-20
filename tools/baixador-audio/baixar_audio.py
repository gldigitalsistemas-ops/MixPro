"""
Baixador de áudio (uso pessoal do dono do Mix Pro; fica fora do app e não vai para os usuários).

Cola o link, clica em Baixar e o áudio vai para a pasta escolhida (padrão: Área de Trabalho). Usa o yt-dlp e um FFmpeg embutido
(imageio-ffmpeg), então o .exe gerado por build.ps1 roda sem instalar nada.
"""

from __future__ import annotations

import ctypes
import json
import os
import queue
import re
import sys
import threading
import tkinter as tk
import uuid
from pathlib import Path
from tkinter import filedialog, ttk

import imageio_ffmpeg
import yt_dlp

APP = "Baixador de áudio — Mix Pro"
# a última pasta escolhida fica guardada aqui (fora do .exe, que é portátil)
CONFIG = Path(os.environ.get("APPDATA", str(Path.home()))) / "MixPro-Baixador" / "config.json"


def desktop_dir() -> Path:
    """Área de Trabalho de verdade (inclusive quando o OneDrive move a pasta)."""
    if os.name == "nt":
        class GUID(ctypes.Structure):
            _fields_ = [("d1", ctypes.c_ulong), ("d2", ctypes.c_ushort), ("d3", ctypes.c_ushort), ("d4", ctypes.c_ubyte * 8)]

        u = uuid.UUID("B4BFCC3A-DB2C-424C-B029-7FE99A87C641")  # FOLDERID_Desktop
        g = GUID(u.fields[0], u.fields[1], u.fields[2], (ctypes.c_ubyte * 8)(*u.bytes[8:]))
        p = ctypes.c_wchar_p()
        if ctypes.windll.shell32.SHGetKnownFolderPath(ctypes.byref(g), 0, None, ctypes.byref(p)) == 0:
            path = Path(p.value)
            ctypes.windll.ole32.CoTaskMemFree(p)
            return path
    return Path.home() / "Desktop"


def load_folder() -> Path:
    try:
        p = Path(json.loads(CONFIG.read_text(encoding="utf-8"))["pasta"])
        if p.is_dir():
            return p
    except Exception:  # noqa: BLE001 — sem configuração: Área de Trabalho
        pass
    return desktop_dir()


def save_folder(p: Path) -> None:
    try:
        CONFIG.parent.mkdir(parents=True, exist_ok=True)
        CONFIG.write_text(json.dumps({"pasta": str(p)}), encoding="utf-8")
    except OSError:
        pass


class App:
    def __init__(self, root: tk.Tk):
        self.root = root
        self.events: queue.Queue = queue.Queue()
        self.busy = False
        root.title(APP)
        root.geometry("580x300")
        self.folder = load_folder()
        root.resizable(False, False)
        frm = ttk.Frame(root, padding=16)
        frm.pack(fill="both", expand=True)

        ttk.Label(frm, text="Cole o link do vídeo:").pack(anchor="w")
        self.url = tk.StringVar()
        entry = ttk.Entry(frm, textvariable=self.url, width=70)
        entry.pack(fill="x", pady=(4, 10))
        entry.focus_set()
        entry.bind("<Return>", lambda _e: self.start())

        row = ttk.Frame(frm)
        row.pack(fill="x")
        ttk.Label(row, text="Formato:").pack(side="left")
        self.fmt = tk.StringVar(value="MP3 (320 kbps)")
        ttk.Combobox(row, textvariable=self.fmt, values=["MP3 (320 kbps)", "WAV"], state="readonly", width=16).pack(side="left", padx=(6, 0))
        ttk.Button(row, text="Colar", command=self.paste).pack(side="right", padx=(6, 0))
        self.btn = ttk.Button(row, text="Baixar", command=self.start)
        self.btn.pack(side="right")

        dest = ttk.Frame(frm)
        dest.pack(fill="x", pady=(12, 0))
        ttk.Label(dest, text="Salvar em:").pack(side="left")
        self.folder_var = tk.StringVar(value=str(self.folder))
        ttk.Entry(dest, textvariable=self.folder_var, state="readonly").pack(side="left", fill="x", expand=True, padx=6)
        ttk.Button(dest, text="Escolher pasta…", command=self.choose).pack(side="left")
        ttk.Button(dest, text="Abrir", command=lambda: os.startfile(self.folder) if os.name == "nt" else None).pack(side="left", padx=(6, 0))

        self.bar = ttk.Progressbar(frm, mode="determinate", maximum=100)
        self.bar.pack(fill="x", pady=(14, 6))
        self.status = tk.StringVar(value="Cole o link e clique em Baixar.")
        ttk.Label(frm, textvariable=self.status, wraplength=520).pack(anchor="w")
        root.after(100, self.poll)

    def choose(self):
        p = filedialog.askdirectory(title="Onde salvar os áudios?", initialdir=str(self.folder), mustexist=True)
        if p:
            self.folder = Path(p)
            self.folder_var.set(str(self.folder))
            save_folder(self.folder)

    def paste(self):
        try:
            self.url.set(self.root.clipboard_get().strip())
        except tk.TclError:
            pass

    def start(self):
        url = self.url.get().strip()
        if self.busy:
            return
        if not re.match(r"^https?://", url):
            self.status.set("Cole um link começando com https://")
            return
        self.busy = True
        self.btn.state(["disabled"])
        self.bar["value"] = 0
        self.status.set("Começando…")
        wav = self.fmt.get().startswith("WAV")
        threading.Thread(target=self.download, args=(url, wav, self.folder), daemon=True).start()

    def download(self, url: str, wav: bool, folder: Path):
        def hook(d):
            if d.get("status") == "downloading":
                total = d.get("total_bytes") or d.get("total_bytes_estimate") or 0
                pct = (d.get("downloaded_bytes", 0) / total * 90) if total else 0
                self.events.put(("progress", pct, "Baixando…"))
            elif d.get("status") == "finished":
                self.events.put(("progress", 92, "Convertendo o áudio…"))

        opts = {
            "format": "bestaudio/best",
            "noplaylist": True,
            "outtmpl": str(folder / "%(title).120B.%(ext)s"),
            "windowsfilenames": True,
            "ffmpeg_location": imageio_ffmpeg.get_ffmpeg_exe(),
            "progress_hooks": [hook],
            "quiet": True,
            "no_warnings": True,
            "postprocessors": [
                {"key": "FFmpegExtractAudio", "preferredcodec": "wav" if wav else "mp3", **({} if wav else {"preferredquality": "320"})}
            ],
        }
        try:
            with yt_dlp.YoutubeDL(opts) as ydl:
                info = ydl.extract_info(url, download=True)
                final = Path(ydl.prepare_filename(info)).with_suffix(".wav" if wav else ".mp3")
            self.events.put(("done", 100, f"Pronto: {final.name}\nem {folder}"))
        except Exception as e:  # noqa: BLE001 — qualquer falha vira mensagem na tela
            msg = str(e).replace("ERROR: ", "")
            if "Sign in" in msg or "bot" in msg:
                msg = "O site pediu confirmação de que não é robô. Tente de novo em alguns minutos."
            elif "Unsupported URL" in msg:
                msg = "Esse link não é suportado."
            self.events.put(("error", 0, f"Não deu certo: {msg[:300]}"))

    def poll(self):
        try:
            while True:
                kind, pct, text = self.events.get_nowait()
                self.bar["value"] = pct
                self.status.set(text)
                if kind in ("done", "error"):
                    self.busy = False
                    self.btn.state(["!disabled"])
                    if kind == "done":
                        self.url.set("")
        except queue.Empty:
            pass
        self.root.after(100, self.poll)


def main():
    if sys.platform == "win32":
        try:
            ctypes.windll.shcore.SetProcessDpiAwareness(1)  # texto nítido em telas com zoom
        except Exception:  # noqa: BLE001
            pass
    root = tk.Tk()
    App(root)
    root.mainloop()


if __name__ == "__main__":
    main()
