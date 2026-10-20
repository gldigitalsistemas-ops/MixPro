"use client";

import { useEffect, useRef, useState } from "react";
import { Camera, Headphones, Play, RefreshCw, Square, Volume2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useToast } from "@/components/ui/toast";
import { cn, formatDuration } from "@/lib/cn";
import type { Signal } from "@/lib/dsp/types";
import { CoverMonitor, DEFAULT_LEVELS, MAX_BOOST_DB, playAndRecordSession, type MonitorLevels } from "@/lib/cover/monitor";

const LEVELS_KEY = "mixpro-cover-levels";

function loadLevels(): MonitorLevels {
  try {
    const v = JSON.parse(localStorage.getItem(LEVELS_KEY) ?? "null") as Partial<MonitorLevels> | null;
    return { ...DEFAULT_LEVELS, ...(v ?? {}) };
  } catch {
    return DEFAULT_LEVELS;
  }
}

/** Formato de vídeo: MP4 primeiro (o Instagram aceita direto); WebM só se o navegador não gravar MP4. */
function pickMime(): string {
  const list = ["video/mp4;codecs=avc1.42E01E,mp4a.40.2", "video/mp4;codecs=avc1,mp4a", "video/mp4", "video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"];
  return list.find((m) => typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(m)) ?? "";
}

function Level({ label, value, onChange, hint }: { label: string; value: number; onChange: (v: number) => void; hint?: string }) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="flex justify-between">
        <span>{label}</span>
        <span className="font-mono text-xs text-violet-200">{value === 0 ? "mudo" : `${value}%`}</span>
      </span>
      <input type="range" min={0} max={100} value={value} onChange={(e) => onChange(Number(e.target.value))} className="accent-violet-500" />
      {hint && <span className="text-xs text-subtle">{hint}</span>}
    </label>
  );
}

/**
 * Gravar o cover pelo app: câmera + microfone (sem os filtros de voz do navegador, que estragam a bateria), a música
 * sem o instrumento da pessoa, o clique e a guia no fone — com o REFORÇO de volume — e contagem de 4 tempos.
 */
export function CoverRecorder({
  music,
  click,
  guide,
  sr,
  bpm,
  partLabel,
  onRecorded,
}: {
  music: Signal;
  click: Float32Array<ArrayBuffer>;
  guide: Signal | null;
  sr: number;
  bpm: number;
  partLabel: string;
  onRecorded: (file: File, estimateS: number | null) => void;
}) {
  const toast = useToast();
  const monitor = useRef<CoverMonitor | null>(null);
  const preview = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const rec = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const lock = useRef<{ release: () => Promise<void> } | null>(null);
  const estimate = useRef<number | null>(null);
  const autoStop = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [levels, setLevels] = useState<MonitorLevels>(DEFAULT_LEVELS);
  const [facing, setFacing] = useState<"user" | "environment">("environment");
  const [camera, setCamera] = useState(false);
  const [phase, setPhase] = useState<"idle" | "testing" | "counting" | "recording" | "saving">("idle");
  const [pos, setPos] = useState(0);

  // retorno no fone: carrega as pistas uma vez
  useEffect(() => {
    // volumes salvos no aparelho (cada fone/bateria pede um ajuste)
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLevels(loadLevels());
    const m = new CoverMonitor();
    m.load({ music, click, guide, sr, bpm });
    monitor.current = m;
    return () => {
      m.dispose();
      monitor.current = null;
    };
  }, [music, click, guide, sr, bpm]);

  useEffect(() => {
    monitor.current?.setLevels(levels);
    try {
      localStorage.setItem(LEVELS_KEY, JSON.stringify(levels));
    } catch {}
  }, [levels]);

  // posição na música (contador na tela)
  useEffect(() => {
    if (phase !== "recording" && phase !== "testing" && phase !== "counting") return;
    const t = setInterval(() => setPos(monitor.current?.position() ?? 0), 250);
    return () => clearInterval(t);
  }, [phase]);

  useEffect(
    () => () => {
      stream.current?.getTracks().forEach((t) => t.stop());
      if (autoStop.current) clearTimeout(autoStop.current);
      void lock.current?.release().catch(() => {});
    },
    [],
  );

  async function openCamera(face = facing) {
    stream.current?.getTracks().forEach((t) => t.stop());
    playAndRecordSession();
    try {
      const s = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: face, width: { ideal: 1080 }, height: { ideal: 1920 }, frameRate: { ideal: 30 } },
        // sem cancelamento de eco, redução de ruído e ganho automático: eles "achatam" e cortam a bateria
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: { ideal: 2 } },
      });
      stream.current = s;
      if (preview.current) {
        preview.current.srcObject = s;
        await preview.current.play().catch(() => {});
      }
      setCamera(true);
    } catch {
      toast.error("Permita o uso da câmera e do microfone para gravar.");
    }
  }

  async function test() {
    if (phase === "testing") {
      monitor.current?.stop();
      setPhase("idle");
      return;
    }
    setPhase("testing");
    // trecho do meio da música, sem contagem: para acertar o volume
    await monitor.current?.start(Math.max(0, (monitor.current?.duration ?? 0) / 3), 0);
  }

  async function record() {
    const s = stream.current;
    const m = monitor.current;
    if (!s || !m) return;
    m.stop();
    const mime = pickMime();
    let r: MediaRecorder;
    try {
      r = new MediaRecorder(s, { ...(mime ? { mimeType: mime } : {}), videoBitsPerSecond: 8_000_000, audioBitsPerSecond: 256_000 });
    } catch {
      toast.error("Este navegador não grava vídeo. Grave com a câmera do celular e envie o vídeo.");
      return;
    }
    try {
      lock.current = await (navigator as Navigator & { wakeLock?: { request: (t: "screen") => Promise<{ release: () => Promise<void> }> } }).wakeLock?.request("screen") ?? null;
    } catch {}
    chunks.current = [];
    estimate.current = null;
    r.ondataavailable = (e) => e.data.size && chunks.current.push(e.data);
    r.onstart = async () => {
      // o vídeo começa agora; a música começa depois da contagem (palpite inicial da sincronia, refinado depois)
      const recStart = m.now();
      setPhase("counting");
      const songAt = await m.start(0, 4);
      estimate.current = songAt - recStart;
      setTimeout(() => setPhase((p) => (p === "counting" ? "recording" : p)), Math.max(0, (songAt - m.now()) * 1000));
      autoStop.current = setTimeout(() => stop(), (songAt - m.now() + m.duration + 2) * 1000);
    };
    r.onstop = () => {
      const type = r.mimeType || mime || "video/mp4";
      const ext = type.includes("mp4") ? "mp4" : "webm";
      const file = new File(chunks.current, `cover-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-")}.${ext}`, { type });
      void lock.current?.release().catch(() => {});
      lock.current = null;
      onRecorded(file, estimate.current);
    };
    rec.current = r;
    r.start(1000);
  }

  function stop() {
    if (autoStop.current) clearTimeout(autoStop.current);
    autoStop.current = null;
    monitor.current?.stop();
    if (rec.current && rec.current.state !== "inactive") {
      setPhase("saving");
      rec.current.stop();
    } else setPhase("idle");
  }

  const busy = phase === "counting" || phase === "recording" || phase === "saving";
  const set = (k: keyof MonitorLevels) => (v: number) => setLevels((l) => ({ ...l, [k]: v }));

  return (
    <div className="flex flex-col gap-4">
      <div className="relative mx-auto aspect-[9/16] h-[min(52vh,520px)] overflow-hidden rounded-3xl bg-black">
        <video ref={preview} muted playsInline className={cn("size-full object-cover", facing === "user" && "-scale-x-100")} />
        {!camera && (
          <button type="button" onClick={() => void openCamera()} className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-sm text-white/80">
            <Camera className="size-8" aria-hidden /> Toque para abrir a câmera
          </button>
        )}
        {(phase === "counting" || phase === "recording") && (
          <div className="absolute inset-x-0 top-0 flex items-center justify-between bg-black/50 px-3 py-2 text-xs text-white">
            <span className="flex items-center gap-1.5">
              <span className="size-2 animate-pulse rounded-full bg-rose-500" /> {phase === "counting" ? "Contagem…" : "Gravando"}
            </span>
            <span className="font-mono">
              {formatDuration(pos)} / {formatDuration(monitor.current?.duration ?? 0)}
            </span>
          </div>
        )}
      </div>

      {camera && (
        <div className="flex justify-center">
          {phase === "counting" || phase === "recording" ? (
            <Button size="lg" variant="danger" onClick={stop}>
              <Square className="size-4" aria-hidden /> Parar
            </Button>
          ) : phase === "saving" ? (
            <Button size="lg" loading>
              Salvando o vídeo…
            </Button>
          ) : (
            <Button size="lg" onClick={() => void record()}>
              <span className="size-3 rounded-full bg-rose-500" aria-hidden /> Gravar (contagem de 4 tempos)
            </Button>
          )}
        </div>
      )}
      <div className="flex flex-wrap justify-center gap-2">
        {camera && !busy && (
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              const f = facing === "user" ? "environment" : "user";
              setFacing(f);
              void openCamera(f);
            }}
          >
            <RefreshCw className="size-4" aria-hidden /> Virar a câmera
          </Button>
        )}
        {!busy && (
          <Button size="sm" variant="secondary" onClick={() => void test()}>
            {phase === "testing" ? <Square className="size-4" aria-hidden /> : <Play className="size-4" aria-hidden />} {phase === "testing" ? "Parar o teste" : "Testar o som no fone"}
          </Button>
        )}
      </div>

      <Card className="flex flex-col gap-3 p-4">
        <p className="flex items-center gap-2 text-sm font-semibold">
          <Headphones className="size-4 text-violet-300" aria-hidden /> O que você ouve no fone
        </p>
        <label className="flex flex-col gap-1 rounded-2xl border border-violet-400/40 bg-primary/10 p-3 text-sm">
          <span className="flex items-center justify-between font-medium">
            <span className="flex items-center gap-2">
              <Volume2 className="size-4" aria-hidden /> Reforço de volume
            </span>
            <span className="font-mono text-violet-200">+{levels.boostDb} dB</span>
          </span>
          <input type="range" min={0} max={MAX_BOOST_DB} value={levels.boostDb} onChange={(e) => set("boostDb")(Number(e.target.value))} className="accent-violet-500" />
          <span className="text-xs text-muted">
            Deixa a música e o clique bem mais altos no fone (para não se perder com a bateria), sem distorcer. Aumente aos poucos e use o volume do celular no máximo.
          </span>
          <span className="text-xs text-amber-200/90">Proteja a sua audição: use só o necessário para ouvir com clareza.</span>
        </label>
        <Level label="Música (sem o seu instrumento)" value={levels.music} onChange={set("music")} />
        <Level label="Clique" value={levels.click} onChange={set("click")} />
        <Level label={`${partLabel} original (guia)`} value={levels.guide} onChange={set("guide")} hint="Para ensaiar: deixe baixinho ou desligue na hora de gravar." />
      </Card>

      <p className="text-center text-xs text-subtle">Use fone de ouvido. A gravação para sozinha quando a música acaba.</p>
    </div>
  );
}
