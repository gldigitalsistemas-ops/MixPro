"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, Pause, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn, formatDuration } from "@/lib/cn";

export type PlayerTrack = { id: string; label: string; url: string };
export type TrackCtl = { volumeDb: number; pan: number; mute: boolean; solo: boolean };

export const DEFAULT_CTL: TrackCtl = { volumeDb: 0, pan: 0, mute: false, solo: false };

/**
 * Toca várias pistas juntas no navegador (Web Audio), com volume, pan, mudo e solo em tempo real.
 * As pistas vêm do servidor já tratadas (M4A); aqui só se mistura — o render final é no servidor.
 */
export function StemsPlayer({ tracks, ctl, onCtl, compact }: { tracks: PlayerTrack[]; ctl: Record<string, TrackCtl>; onCtl: (id: string, c: TrackCtl) => void; compact?: boolean }) {
  const ctxRef = useRef<AudioContext | null>(null);
  const buffers = useRef<Map<string, AudioBuffer>>(new Map());
  const nodes = useRef<Map<string, { src: AudioBufferSourceNode; gain: GainNode; pan: StereoPannerNode }>>(new Map());
  const startRef = useRef({ at: 0, offset: 0 });
  const [loading, setLoading] = useState(0);
  const [ready, setReady] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [pos, setPos] = useState(0);
  const [dur, setDur] = useState(0);
  const key = tracks.map((t) => t.url).join("|");

  useEffect(() => {
    let alive = true;
    const ctx = new AudioContext();
    ctxRef.current = ctx;
    buffers.current = new Map();
    const live = nodes.current;
    (async () => {
      await Promise.resolve();
      if (!alive) return;
      setReady(false);
      setLoading(0);
      let done = 0;
      for (const t of tracks) {
        try {
          const data = await (await fetch(t.url)).arrayBuffer();
          const b = await ctx.decodeAudioData(data);
          buffers.current.set(t.id, b);
        } catch {
          // pista que não carregou fica de fora (as outras tocam)
        }
        done++;
        if (alive) setLoading(done / tracks.length);
      }
      if (!alive) return;
      setDur(Math.max(0, ...[...buffers.current.values()].map((b) => b.duration)));
      setReady(true);
    })();
    return () => {
      alive = false;
      for (const n of live.values()) n.src.stop();
      live.clear();
      void ctx.close();
    };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  const anySolo = Object.values(ctl).some((c) => c.solo);
  const gainOf = (id: string) => {
    const c = ctl[id] ?? DEFAULT_CTL;
    const audible = anySolo ? c.solo : !c.mute;
    return audible ? 10 ** (c.volumeDb / 20) : 0;
  };

  // controles em tempo real
  useEffect(() => {
    for (const [id, n] of nodes.current) {
      n.gain.gain.setTargetAtTime(gainOf(id), ctxRef.current!.currentTime, 0.02);
      n.pan.pan.setTargetAtTime(ctl[id]?.pan ?? 0, ctxRef.current!.currentTime, 0.02);
    }
  });

  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    const tick = () => {
      const ctx = ctxRef.current!;
      const p = startRef.current.offset + (ctx.currentTime - startRef.current.at);
      setPos(Math.min(p, dur));
      if (p >= dur) stop(0);
      else raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, dur]);

  function start(offset: number) {
    const ctx = ctxRef.current!;
    void ctx.resume();
    for (const n of nodes.current.values()) n.src.stop();
    nodes.current.clear();
    const at = ctx.currentTime + 0.05;
    for (const t of tracks) {
      const b = buffers.current.get(t.id);
      if (!b) continue;
      const src = ctx.createBufferSource();
      src.buffer = b;
      const gain = ctx.createGain();
      gain.gain.value = gainOf(t.id);
      const pan = ctx.createStereoPanner();
      pan.pan.value = ctl[t.id]?.pan ?? 0;
      src.connect(gain).connect(pan).connect(ctx.destination);
      src.start(at, Math.min(offset, b.duration));
      nodes.current.set(t.id, { src, gain, pan });
    }
    startRef.current = { at, offset };
    setPlaying(true);
  }
  function stop(at?: number) {
    const ctx = ctxRef.current!;
    for (const n of nodes.current.values()) n.src.stop();
    nodes.current.clear();
    setPlaying(false);
    setPos(at ?? startRef.current.offset + (ctx.currentTime - startRef.current.at));
  }

  if (!ready)
    return (
      <p className="flex items-center gap-2 text-sm text-muted">
        <Loader2 className="size-4 animate-spin" aria-hidden /> Carregando as pistas… {Math.round(loading * 100)}%
      </p>
    );

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <Button size="sm" onClick={() => (playing ? stop() : start(pos >= dur ? 0 : pos))} aria-label={playing ? "Pausar" : "Tocar"}>
          {playing ? <Pause className="size-4" aria-hidden /> : <Play className="size-4" aria-hidden />} {playing ? "Pausar" : "Tocar"}
        </Button>
        <input
          type="range"
          min={0}
          max={dur || 1}
          step={0.1}
          value={pos}
          aria-label="Posição"
          onChange={(e) => {
            const v = Number(e.target.value);
            if (playing) start(v);
            else setPos(v);
          }}
          className="flex-1 accent-violet-500"
        />
        <span className="font-mono text-xs text-muted">
          {formatDuration(pos)} / {formatDuration(dur)}
        </span>
      </div>
      <div className={cn("grid gap-2", compact ? "sm:grid-cols-2" : "")}>
        {tracks.map((t) => {
          const c = ctl[t.id] ?? DEFAULT_CTL;
          const set = (patch: Partial<TrackCtl>) => onCtl(t.id, { ...c, ...patch });
          return (
            <div key={t.id} className={cn("flex flex-wrap items-center gap-2 rounded-xl border border-border px-3 py-2", !buffers.current.has(t.id) && "opacity-40")}>
              <span className="w-28 truncate text-sm font-medium" title={t.label}>
                {t.label}
              </span>
              <button type="button" onClick={() => set({ mute: !c.mute })} className={cn("rounded-md px-2 py-0.5 text-xs font-bold", c.mute ? "bg-rose-500/80 text-white" : "bg-white/10 text-muted")} aria-pressed={c.mute}>
                M
              </button>
              <button type="button" onClick={() => set({ solo: !c.solo })} className={cn("rounded-md px-2 py-0.5 text-xs font-bold", c.solo ? "bg-amber-400 text-black" : "bg-white/10 text-muted")} aria-pressed={c.solo}>
                S
              </button>
              <label className="flex min-w-32 flex-1 items-center gap-2 text-xs text-muted">
                Vol
                <input type="range" min={-24} max={12} step={0.5} value={c.volumeDb} onChange={(e) => set({ volumeDb: Number(e.target.value) })} className="flex-1 accent-violet-500" aria-label={`Volume de ${t.label}`} />
                <span className="w-12 text-right font-mono">{c.volumeDb > 0 ? "+" : ""}{c.volumeDb.toFixed(1)}</span>
              </label>
              <label className="flex w-36 items-center gap-2 text-xs text-muted">
                Pan
                <input type="range" min={-1} max={1} step={0.05} value={c.pan} onChange={(e) => set({ pan: Number(e.target.value) })} className="flex-1 accent-violet-500" aria-label={`Pan de ${t.label}`} />
              </label>
            </div>
          );
        })}
      </div>
    </div>
  );
}
