"use client";

import { useEffect, useRef, useState } from "react";
import { Pause, Play } from "lucide-react";
import { cn } from "@/lib/cn";

/** Antes/depois de verdade: os dois áudios tocam juntos e a troca só alterna qual está audível. */
export function DemoPlayer() {
  const before = useRef<HTMLAudioElement>(null);
  const after = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [side, setSide] = useState<"antes" | "depois">("antes");
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    if (before.current) before.current.muted = side !== "antes";
    if (after.current) after.current.muted = side !== "depois";
  }, [side]);

  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    const tick = () => {
      const a = before.current;
      const b = after.current;
      if (a && b) {
        if (Math.abs(a.currentTime - b.currentTime) > 0.08) b.currentTime = a.currentTime;
        setProgress(a.duration ? a.currentTime / a.duration : 0);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  async function toggle() {
    const a = before.current;
    const b = after.current;
    if (!a || !b) return;
    if (playing) {
      a.pause();
      b.pause();
      setPlaying(false);
      return;
    }
    b.currentTime = a.currentTime;
    await Promise.all([a.play(), b.play()]).catch(() => {});
    setPlaying(true);
  }

  return (
    <div className="glass flex flex-col gap-5 rounded-3xl p-5 md:p-7">
      <div>
        <p className="text-xs uppercase tracking-wider text-violet-300">Ouça a diferença</p>
        <h2 className="mt-1 font-display text-2xl font-semibold md:text-3xl">Gravado no celular, com ventilador ligado</h2>
        <p className="mt-1 text-sm text-muted">
          Mesma gravação, sem editar nada: só o preset “Voz de YouTuber” e a remoção de ruído. Troque no meio da fala.
        </p>
      </div>

      <div className="flex items-center gap-4">
        <button
          onClick={toggle}
          aria-label={playing ? "Pausar" : "Tocar"}
          className="bg-brand grid size-16 shrink-0 place-items-center rounded-full text-white shadow-[0_8px_30px_-6px_rgb(124_58_237/0.7)]"
        >
          {playing ? <Pause className="size-7" /> : <Play className="size-7 translate-x-0.5" />}
        </button>
        <div className="grid flex-1 grid-cols-2 rounded-2xl border border-border-strong p-1" role="group" aria-label="Antes ou depois">
          {(["antes", "depois"] as const).map((s) => (
            <button
              key={s}
              onClick={() => setSide(s)}
              aria-pressed={side === s}
              className={cn(
                "h-12 rounded-xl text-sm font-semibold capitalize transition",
                side === s ? (s === "antes" ? "bg-white/10 text-text" : "bg-brand text-white") : "text-muted hover:text-text",
              )}
            >
              {s === "antes" ? "Antes" : "Depois · Mix Pro"}
            </button>
          ))}
        </div>
      </div>

      <div className="h-1.5 overflow-hidden rounded-full bg-white/8" aria-hidden>
        <div className={cn("h-full transition-[width]", side === "depois" ? "bg-brand" : "bg-white/40")} style={{ width: `${progress * 100}%` }} />
      </div>

      <audio ref={before} src="/demo/antes.m4a" preload="auto" loop />
      <audio ref={after} src="/demo/depois.m4a" preload="auto" loop muted />
    </div>
  );
}
