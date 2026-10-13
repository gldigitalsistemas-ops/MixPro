"use client";

import { useEffect, useRef, useState } from "react";
import { Headphones, Mic, Square, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { formatDuration } from "@/lib/cn";

/**
 * Gravar a voz em cima da base (no fone de ouvido) ou enviar a gravação feita no estúdio/celular.
 * O alinhamento fino com a base é feito no servidor (até ±3 s), então o atraso do fone não importa.
 */
export function VoiceRecorder({ baseUrl, onReady }: { baseUrl: string; onReady: (file: File) => void }) {
  const toast = useToast();
  const audio = useRef<HTMLAudioElement>(null);
  const rec = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const [recording, setRecording] = useState(false);
  const [secs, setSecs] = useState(0);
  const [take, setTake] = useState<{ url: string; file: File } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!recording) return;
    const t = setInterval(() => setSecs((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [recording]);

  async function startRec() {
    let stream: MediaStream;
    try {
      // sem cancelamento de eco/ruído do navegador: eles estragam a voz cantada
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 } });
    } catch {
      toast.error("Permita o uso do microfone para gravar.");
      return;
    }
    const mime = ["audio/webm;codecs=opus", "audio/mp4", "audio/webm"].find((m) => MediaRecorder.isTypeSupported(m)) ?? "";
    const r = new MediaRecorder(stream, mime ? { mimeType: mime, audioBitsPerSecond: 192000 } : undefined);
    chunks.current = [];
    r.ondataavailable = (e) => e.data.size && chunks.current.push(e.data);
    r.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      const type = r.mimeType || "audio/webm";
      const blob = new Blob(chunks.current, { type });
      const file = new File([blob], `voz-gravada.${type.includes("mp4") ? "m4a" : "webm"}`, { type });
      setTake({ url: URL.createObjectURL(blob), file });
    };
    rec.current = r;
    setSecs(0);
    setTake(null);
    r.start(1000);
    if (audio.current) {
      audio.current.currentTime = 0;
      void audio.current.play();
    }
    setRecording(true);
  }

  function stopRec() {
    rec.current?.stop();
    audio.current?.pause();
    setRecording(false);
  }

  return (
    <div className="flex flex-col gap-3">
      <audio ref={audio} src={baseUrl} preload="auto" onEnded={() => recording && stopRec()} />
      <p className="flex items-center gap-2 text-sm text-muted">
        <Headphones className="size-4" aria-hidden /> Use fone de ouvido: a base toca no fone e só a sua voz é gravada.
      </p>
      <div className="flex flex-wrap gap-2">
        {recording ? (
          <Button variant="danger" onClick={stopRec}>
            <Square className="size-4" aria-hidden /> Parar ({formatDuration(secs)})
          </Button>
        ) : (
          <Button onClick={() => void startRec()}>
            <Mic className="size-4" aria-hidden /> {take ? "Gravar de novo" : "Gravar agora"}
          </Button>
        )}
        <Button variant="secondary" onClick={() => fileRef.current?.click()} disabled={recording}>
          <Upload className="size-4" aria-hidden /> Enviar gravação pronta
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept="audio/*,.wav,.mp3,.m4a,.aif,.aiff,.flac"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onReady(f);
          }}
        />
      </div>
      {take && (
        <div className="flex flex-col gap-2 rounded-2xl border border-border p-3">
          <audio controls src={take.url} className="w-full" />
          <Button size="sm" className="self-start" onClick={() => onReady(take.file)}>
            Usar esta gravação
          </Button>
        </div>
      )}
    </div>
  );
}
