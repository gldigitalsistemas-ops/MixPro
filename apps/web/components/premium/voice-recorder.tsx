"use client";

import { useEffect, useRef, useState } from "react";
import { Headphones, Mic, Play, Square, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { cn, formatDuration } from "@/lib/cn";

export type MapLine = { t: number | null; linha: string; parte: string };

/** Linha que está sendo cantada agora (a última que já começou). */
export function currentLine(map: MapLine[], time: number): number {
  let cur = -1;
  for (let i = 0; i < map.length; i++) if (map[i].t !== null && map[i].t! <= time + 0.15) cur = i;
  return cur;
}

/** Contagem de 4 tempos no andamento da base (clique gerado no navegador). */
async function countIn(bpm: number): Promise<void> {
  const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  if (!Ctx) return;
  const ctx = new Ctx();
  const beat = 60 / Math.max(40, Math.min(240, bpm));
  const t0 = ctx.currentTime + 0.1;
  for (let i = 0; i < 4; i++) {
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.frequency.value = i === 0 ? 1500 : 1000;
    g.gain.setValueAtTime(0.5, t0 + i * beat);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + i * beat + 0.08);
    osc.connect(g).connect(ctx.destination);
    osc.start(t0 + i * beat);
    osc.stop(t0 + i * beat + 0.1);
  }
  await new Promise((r) => setTimeout(r, (0.1 + 4 * beat) * 1000));
  void ctx.close();
}

/**
 * Gravar a voz em cima da base (no fone de ouvido) ou enviar a gravação feita no estúdio/celular.
 * Na Produção: a voz guia da IA toca junto (desliga ou abaixa), a letra aparece no tempo e há contagem antes.
 * O alinhamento fino com a base é feito no servidor (até ±3 s), então o atraso do fone não importa.
 */
export function VoiceRecorder({ baseUrl, guideUrl, map, bpm, onReady }: { baseUrl: string; guideUrl?: string | null; map?: MapLine[] | null; bpm?: number | null; onReady: (file: File) => void }) {
  const toast = useToast();
  const audio = useRef<HTMLAudioElement>(null);
  const guide = useRef<HTMLAudioElement>(null);
  const rec = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const [recording, setRecording] = useState(false);
  const [listening, setListening] = useState(false);
  const [counting, setCounting] = useState(false);
  const [secs, setSecs] = useState(0);
  const [time, setTime] = useState(0);
  const [guideOn, setGuideOn] = useState(true);
  const [guideVol, setGuideVol] = useState(60);
  const [take, setTake] = useState<{ url: string; file: File } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const lines = (map ?? []).filter((l) => l.linha);
  const timed = lines.some((l) => l.t !== null);

  useEffect(() => {
    if (!recording) return;
    const t = setInterval(() => setSecs((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [recording]);

  // a letra acompanha a base; a voz guia segue a base (mesmo instante, volume e liga/desliga)
  useEffect(() => {
    if (!recording && !listening) return;
    let raf = 0;
    const tick = () => {
      const a = audio.current;
      if (a) {
        setTime(a.currentTime);
        const g = guide.current;
        if (g && Math.abs(g.currentTime - a.currentTime) > 0.08) g.currentTime = a.currentTime;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [recording, listening]);

  useEffect(() => {
    if (guide.current) {
      guide.current.volume = guideVol / 100;
      guide.current.muted = !guideOn;
    }
  }, [guideOn, guideVol]);

  function play() {
    const a = audio.current;
    if (!a) return;
    a.currentTime = 0;
    void a.play();
    if (guide.current && guideUrl) {
      guide.current.currentTime = 0;
      void guide.current.play();
    }
  }

  function stopAll() {
    audio.current?.pause();
    guide.current?.pause();
  }

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
    setListening(false);
    stopAll();
    // contagem de 4 tempos antes (o andamento é sempre inteiro)
    if (bpm) {
      setCounting(true);
      await countIn(Math.round(bpm));
      setCounting(false);
    }
    r.start(1000);
    play();
    setRecording(true);
  }

  function stopRec() {
    rec.current?.stop();
    stopAll();
    setRecording(false);
  }

  const cur = timed ? currentLine(lines, time) : -1;
  const active = recording || listening;

  return (
    <div className="flex flex-col gap-3">
      <audio ref={audio} src={baseUrl} preload="auto" onEnded={() => (recording ? stopRec() : setListening(false))} />
      {guideUrl && <audio ref={guide} src={guideUrl} preload="auto" />}
      <p className="flex items-center gap-2 text-sm text-muted">
        <Headphones className="size-4" aria-hidden /> Use fone de ouvido: a base{guideUrl ? " e a voz guia tocam" : " toca"} no fone e só a sua voz é gravada.
      </p>
      {guideUrl && (
        <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-border p-3 text-sm">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={guideOn} onChange={(e) => setGuideOn(e.target.checked)} className="accent-violet-500" /> Voz guia da IA
          </label>
          <label className="flex flex-1 items-center gap-2 text-xs text-muted">
            Volume
            <input type="range" min={0} max={100} value={guideVol} onChange={(e) => setGuideVol(Number(e.target.value))} disabled={!guideOn} className="flex-1 accent-violet-500" />
          </label>
          <span className="w-full text-xs text-subtle">A voz guia mostra onde entrar e a melodia; a letra certa é a que aparece abaixo.</span>
        </div>
      )}
      {lines.length > 0 && (
        <div className="max-h-64 overflow-y-auto rounded-2xl bg-black/30 p-4" aria-live="polite">
          {counting && <p className="mb-2 text-center text-sm font-semibold text-violet-200">Prepare-se… 1, 2, 3, 4</p>}
          {lines.map((l, i) => {
            const show = !timed || !active || Math.abs(i - Math.max(0, cur)) <= 3;
            if (!show) return null;
            const header = i === 0 || lines[i - 1].parte !== l.parte;
            return (
              <div key={i}>
                {header && <p className="mt-2 text-[10px] font-semibold uppercase tracking-wider text-violet-300/70">{l.parte}</p>}
                <p className={cn("py-0.5 transition-all", active && timed ? (i === cur ? "text-lg font-semibold text-white" : i === cur + 1 ? "text-sm text-violet-100" : "text-sm text-muted") : "text-sm text-text")}>
                  {l.t !== null && !active && <span className="mr-2 font-mono text-xs text-subtle">{formatDuration(l.t)}</span>}
                  {l.linha}
                </p>
              </div>
            );
          })}
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        {recording ? (
          <Button variant="danger" onClick={stopRec}>
            <Square className="size-4" aria-hidden /> Parar ({formatDuration(secs)})
          </Button>
        ) : (
          <Button onClick={() => void startRec()} loading={counting}>
            <Mic className="size-4" aria-hidden /> {take ? "Gravar de novo" : "Gravar agora"}
          </Button>
        )}
        {!recording &&
          (listening ? (
            <Button
              variant="secondary"
              onClick={() => {
                stopAll();
                setListening(false);
              }}
            >
              <Square className="size-4" aria-hidden /> Parar de ouvir
            </Button>
          ) : (
            <Button
              variant="secondary"
              onClick={() => {
                setListening(true);
                play();
              }}
            >
              <Play className="size-4" aria-hidden /> Ouvir {lines.length ? "com a letra" : "a base"}
            </Button>
          ))}
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
