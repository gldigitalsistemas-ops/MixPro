"use client";

import { useCallback, useEffect, useRef } from "react";
import { cn } from "@/lib/cn";

type Props = {
  peaks: number[] | null;
  /** 0–1 */
  progress?: number;
  /** Janela destacada (0–1), ex.: trecho do preview. */
  selection?: { start: number; end: number } | null;
  onSeek?: (fraction: number) => void;
  height?: number;
  variant?: "brand" | "muted" | "blue";
  className?: string;
  ariaLabel?: string;
};

const PALETTES = {
  brand: ["#d946ef", "#7c3aed", "#3b82f6"],
  blue: ["#60a5fa", "#3b82f6", "#22d3ee"],
  muted: ["#6f6f98", "#6f6f98", "#6f6f98"],
};

/** Waveform em canvas a partir de picos pré-calculados pelo worker (0–255). */
export function Waveform({
  peaks,
  progress = 0,
  selection,
  onSeek,
  height = 72,
  variant = "brand",
  className,
  ariaLabel = "Forma de onda",
}: Props) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const wrap = useRef<HTMLDivElement>(null);

  const draw = useCallback(() => {
    const c = canvas.current;
    const w = wrap.current;
    if (!c || !w) return;
    const dpr = window.devicePixelRatio || 1;
    const width = w.clientWidth;
    c.width = Math.max(1, Math.floor(width * dpr));
    c.height = Math.floor(height * dpr);
    c.style.width = `${width}px`;
    c.style.height = `${height}px`;
    const g = c.getContext("2d");
    if (!g) return;
    g.scale(dpr, dpr);
    g.clearRect(0, 0, width, height);

    if (selection) {
      g.fillStyle = "rgba(124,58,237,0.14)";
      g.fillRect(selection.start * width, 0, (selection.end - selection.start) * width, height);
      g.fillStyle = "rgba(167,139,250,0.7)";
      g.fillRect(selection.start * width, 0, 1.5, height);
      g.fillRect(selection.end * width - 1.5, 0, 1.5, height);
    }

    if (!peaks || peaks.length === 0) {
      g.fillStyle = "rgba(255,255,255,0.08)";
      g.fillRect(0, height / 2 - 1, width, 2);
      return;
    }

    const bar = 2;
    const gap = 1;
    const count = Math.max(1, Math.floor(width / (bar + gap)));
    const [c0, c1, c2] = PALETTES[variant];
    const grad = g.createLinearGradient(0, 0, width, 0);
    grad.addColorStop(0, c0);
    grad.addColorStop(0.5, c1);
    grad.addColorStop(1, c2);
    const mid = height / 2;
    const played = progress * width;

    for (let i = 0; i < count; i++) {
      const from = Math.floor((i / count) * peaks.length);
      const to = Math.max(from + 1, Math.floor(((i + 1) / count) * peaks.length));
      let v = 0;
      for (let j = from; j < to; j++) if (peaks[j] > v) v = peaks[j];
      const h = Math.max(1.5, (v / 255) * (height - 4));
      const x = i * (bar + gap);
      g.globalAlpha = x <= played ? 1 : 0.42;
      g.fillStyle = grad;
      g.fillRect(x, mid - h / 2, bar, h);
    }
    g.globalAlpha = 1;
    if (progress > 0) {
      g.fillStyle = "#ffffff";
      g.fillRect(Math.min(played, width - 1.5), 0, 1.5, height);
    }
  }, [peaks, progress, selection, height, variant]);

  useEffect(() => {
    draw();
    const ro = new ResizeObserver(draw);
    if (wrap.current) ro.observe(wrap.current);
    return () => ro.disconnect();
  }, [draw]);

  const seekFromEvent = (clientX: number) => {
    const rect = wrap.current?.getBoundingClientRect();
    if (!rect || !onSeek) return;
    onSeek(Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)));
  };

  return (
    <div
      ref={wrap}
      className={cn("relative w-full select-none", onSeek && "cursor-pointer", className)}
      style={{ height }}
      role={onSeek ? "slider" : "img"}
      aria-label={ariaLabel}
      aria-valuemin={onSeek ? 0 : undefined}
      aria-valuemax={onSeek ? 100 : undefined}
      aria-valuenow={onSeek ? Math.round(progress * 100) : undefined}
      tabIndex={onSeek ? 0 : undefined}
      onPointerDown={(e) => seekFromEvent(e.clientX)}
      onKeyDown={(e) => {
        if (!onSeek) return;
        if (e.key === "ArrowRight") onSeek(Math.min(1, progress + 0.05));
        if (e.key === "ArrowLeft") onSeek(Math.max(0, progress - 0.05));
      }}
    >
      <canvas ref={canvas} className="block" />
    </div>
  );
}
