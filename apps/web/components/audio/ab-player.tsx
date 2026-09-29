"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Pause, Play, Volume2 } from "lucide-react";
import { ABEngine } from "@/lib/audio/ab-engine";
import { Waveform } from "@/components/audio/waveform";
import { cn, formatDuration } from "@/lib/cn";

export type ABSource = {
  /** Muda quando o conteúdo muda (preset/intensidade). */
  key: string;
  buffer: AudioBuffer;
  peaks: number[];
  lufs: number | null;
};

type Props = {
  original: ABSource | null;
  processed: ABSource | null;
  busy?: string | null;
  /** Início do trecho dentro do arquivo (s), para exibir o tempo real e sincronizar o vídeo. */
  offsetSeconds?: number;
  /** Vídeo exibido sem som, acompanhando o áudio A/B. */
  videoUrl?: string | null;
  /** Desenha por cima do vídeo (ex.: legendas) no tempo do quadro exibido. */
  overlay?: ((ctx: CanvasRenderingContext2D, width: number, height: number, t: number) => void) | null;
};

function useEngine(engine: ABEngine) {
  const snap = () => `${engine.playing}|${engine.side}|${engine.levelMatch}|${engine.volume}|${engine.hasB}|${engine.duration}`;
  useSyncExternalStore((cb) => engine.subscribe(cb), snap, () => "");
}

/** Posiciona o canvas exatamente sobre a imagem do vídeo (object-contain) e desenha o overlay. */
function paintOverlay(v: HTMLVideoElement, canvas: HTMLCanvasElement, draw: Props["overlay"]) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  if (!draw || !v.videoWidth) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    return;
  }
  const s = Math.min(v.clientWidth / v.videoWidth, v.clientHeight / v.videoHeight);
  const cw = v.videoWidth * s;
  const ch = v.videoHeight * s;
  const dpr = window.devicePixelRatio || 1;
  const pw = Math.round(cw * dpr);
  const ph = Math.round(ch * dpr);
  if (canvas.width !== pw || canvas.height !== ph) {
    canvas.width = pw;
    canvas.height = ph;
    canvas.style.width = `${cw}px`;
    canvas.style.height = `${ch}px`;
    canvas.style.left = `${(v.clientWidth - cw) / 2}px`;
    canvas.style.top = `${(v.clientHeight - ch) / 2}px`;
  }
  ctx.clearRect(0, 0, pw, ph);
  draw(ctx, pw, ph, v.currentTime);
}

export function ABPlayer({ original, processed, busy, offsetSeconds = 0, videoUrl, overlay }: Props) {
  const [engine] = useState(() => new ABEngine());
  useEngine(engine);
  const [time, setTime] = useState(0);
  const video = useRef<HTMLVideoElement>(null);
  const overlayCanvas = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef(overlay);
  useEffect(() => {
    overlayRef.current = overlay;
  }, [overlay]);

  const origKey = original?.key;
  const procKey = processed?.key;
  useEffect(() => {
    engine.setBuffers(original?.buffer ?? null, processed?.buffer ?? null);
    if (processed) engine.setSide("B");
  }, [origKey, procKey]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => engine.dispose(), [engine]);

  // Relógio da UI + vídeo seguindo o áudio (corrige deriva e o loop do trecho)
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const t = engine.currentTime();
      setTime(t);
      const v = video.current;
      if (v) {
        const target = offsetSeconds + t;
        if (engine.playing) {
          if (v.paused) void v.play().catch(() => {});
          if (Math.abs(v.currentTime - target) > 0.2) v.currentTime = target;
        } else {
          if (!v.paused) v.pause();
          if (Math.abs(v.currentTime - target) > 0.05) v.currentTime = target;
        }
        if (overlayCanvas.current) paintOverlay(v, overlayCanvas.current, overlayRef.current);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [engine, offsetSeconds]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t && ["INPUT", "TEXTAREA", "SELECT", "BUTTON"].includes(t.tagName)) return;
      if (e.code === "Space") {
        e.preventDefault();
        engine.toggle();
      } else if (e.key.toLowerCase() === "a") engine.setSide("A");
      else if (e.key.toLowerCase() === "b") engine.setSide("B");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [engine]);

  const matchGain = useMemo(() => {
    if (original?.lufs == null || processed?.lufs == null) return 1;
    if (!Number.isFinite(original.lufs) || !Number.isFinite(processed.lufs)) return 1;
    return Math.pow(10, (original.lufs - processed.lufs) / 20);
  }, [original?.lufs, processed?.lufs]);

  useEffect(() => {
    if (engine.levelMatch) engine.setLevelMatch(true, matchGain);
  }, [engine, matchGain]);

  const duration = engine.duration;
  const progress = duration > 0 ? time / duration : 0;
  const showB = engine.side === "B" && engine.hasB;
  const peaks = showB ? processed?.peaks : original?.peaks;

  return (
    <div className="flex flex-col gap-4">
      {videoUrl && (
        <div className="relative mx-auto w-full max-w-sm overflow-hidden rounded-2xl bg-black">
          <video ref={video} src={videoUrl} muted playsInline preload="auto" className="max-h-[50dvh] w-full object-contain" />
          <canvas ref={overlayCanvas} className="pointer-events-none absolute" aria-hidden />
          <span
            className={cn(
              "absolute left-2 top-2 rounded-full px-2.5 py-1 text-[11px] font-semibold backdrop-blur",
              showB ? "bg-primary/70 text-white" : "bg-blue/70 text-white",
            )}
          >
            {showB ? "Com Mix Pro" : "Original"}
          </span>
        </div>
      )}

      <div className="relative rounded-2xl bg-black/25 p-3">
        <div className="mb-2 flex items-center justify-between text-xs text-muted">
          <span className={cn("font-medium", showB ? "text-violet-300" : "text-blue-300")}>
            {showB ? "Com Mix Pro" : "Original"}
          </span>
          <span className="tabular-nums">
            {formatDuration(offsetSeconds + time)} · trecho de {formatDuration(duration)}
          </span>
        </div>
        <Waveform
          peaks={peaks ?? null}
          progress={progress}
          onSeek={(f) => engine.seek(f * duration)}
          variant={showB ? "brand" : "blue"}
          height={72}
          ariaLabel="Posição da reprodução"
        />
        {busy && (
          <div className="absolute inset-0 grid place-items-center rounded-2xl bg-bg/55 text-sm text-muted backdrop-blur-[2px]">
            {busy}
          </div>
        )}
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={() => engine.toggle()}
          disabled={!original}
          aria-label={engine.playing ? "Pausar" : "Tocar"}
          className="bg-brand grid size-14 shrink-0 place-items-center rounded-full text-white shadow-[0_8px_30px_-6px_rgb(124_58_237/0.7)] transition hover:brightness-110 disabled:opacity-50"
        >
          {engine.playing ? <Pause className="size-6" /> : <Play className="size-6 translate-x-0.5" />}
        </button>

        <div className="grid flex-1 grid-cols-2 rounded-2xl border border-border-strong p-1" role="group" aria-label="Comparar antes e depois">
          {(["A", "B"] as const).map((s) => (
            <button
              key={s}
              onClick={() => engine.setSide(s)}
              disabled={s === "B" && !engine.hasB}
              aria-pressed={engine.side === s}
              className={cn(
                "flex h-12 flex-col items-center justify-center rounded-xl text-xs font-semibold transition disabled:opacity-40",
                engine.side === s ? (s === "A" ? "bg-blue/20 text-blue-200" : "bg-primary/25 text-violet-200") : "text-muted hover:text-text",
              )}
            >
              <span className="text-sm">{s === "A" ? "Antes" : "Depois"}</span>
              <span className="text-[10px] font-normal opacity-80">{s === "A" ? "Original" : "Com Mix Pro"}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-muted">
        <label className="flex items-center gap-2">
          <Volume2 className="size-4" aria-hidden />
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={engine.volume}
            onChange={(e) => engine.setVolume(Number(e.target.value))}
            aria-label="Volume"
            className="w-24 accent-violet-500"
          />
        </label>
        <label className="flex cursor-pointer items-center gap-2" title="Compensa a diferença de volume para comparar só a qualidade do som">
          <input
            type="checkbox"
            checked={engine.levelMatch}
            disabled={!engine.hasB || matchGain === 1}
            onChange={(e) => engine.setLevelMatch(e.target.checked, matchGain)}
            className="accent-violet-500"
          />
          Comparar no mesmo volume
        </label>
        <span className="hidden md:inline">Atalhos: espaço, A, B</span>
      </div>
    </div>
  );
}
