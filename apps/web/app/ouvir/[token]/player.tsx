"use client";

import { useEffect, useRef, useState } from "react";
import { Pause, Play } from "lucide-react";
import { cn } from "@/lib/cn";

/**
 * Toca os dois trechos juntos (um em silêncio) e alterna entre eles sem perder a posição: a comparação
 * é sempre do mesmo ponto. O "depois" já vem nivelado; o "antes" toca como foi gravado.
 */
export function BeforeAfterPlayer(props: { before: string; after: string; lufsBefore: number | null; lufsAfter: number | null }) {
  const a = useRef<HTMLAudioElement>(null);
  const b = useRef<HTMLAudioElement>(null);
  const [side, setSide] = useState<"before" | "after">("after");
  const [playing, setPlaying] = useState(false);
  const [failed, setFailed] = useState(false);
  const [pos, setPos] = useState(0);
  const [dur, setDur] = useState(0);

  useEffect(() => {
    if (a.current) a.current.muted = side !== "before";
    if (b.current) b.current.muted = side !== "after";
  }, [side]);

  async function toggle() {
    const x = a.current;
    const y = b.current;
    if (!x || !y) return;
    if (playing) {
      x.pause();
      y.pause();
      setPlaying(false);
      return;
    }
    y.currentTime = x.currentTime = Math.min(x.currentTime, y.currentTime);
    try {
      await Promise.all([x.play(), y.play()]);
      setPlaying(true);
    } catch {
      setFailed(true);
    }
  }

  function onTime() {
    const x = a.current;
    const y = b.current;
    if (!x || !y) return;
    // mantém os dois no mesmo ponto (o navegador pode desalinhar alguns ms)
    if (Math.abs(x.currentTime - y.currentTime) > 0.08) x.currentTime = y.currentTime;
    setPos(y.currentTime);
  }

  if (failed) return <p className="text-sm text-muted">Não foi possível tocar os áudios. Eles podem ainda estar sendo enviados: atualize a página em instantes.</p>;
  const delta = props.lufsBefore !== null && props.lufsAfter !== null ? props.lufsAfter - props.lufsBefore : null;
  return (
    <div className="flex w-full flex-col gap-4">
      <audio ref={a} src={props.before} preload="auto" onError={() => setFailed(true)} />
      <audio
        ref={b}
        src={props.after}
        preload="auto"
        onError={() => setFailed(true)}
        onTimeUpdate={onTime}
        onLoadedMetadata={(e) => setDur(e.currentTarget.duration)}
        onEnded={() => {
          setPlaying(false);
          a.current?.pause();
          if (a.current) a.current.currentTime = 0;
          if (b.current) b.current.currentTime = 0;
        }}
      />
      <div className="grid grid-cols-2 gap-2 rounded-2xl bg-white/5 p-1" role="radiogroup" aria-label="Versão">
        {(["before", "after"] as const).map((s) => (
          <button
            key={s}
            type="button"
            role="radio"
            aria-checked={side === s}
            onClick={() => setSide(s)}
            className={cn("rounded-xl py-2 text-sm font-semibold transition", side === s ? "bg-primary text-white" : "text-muted")}
          >
            {s === "before" ? "Antes" : "Depois"}
          </button>
        ))}
      </div>
      <button type="button" onClick={() => void toggle()} className="bg-brand mx-auto grid size-16 place-items-center rounded-full text-white" aria-label={playing ? "Pausar" : "Tocar"}>
        {playing ? <Pause className="size-7" /> : <Play className="size-7" />}
      </button>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10" aria-hidden>
        <div className="h-full bg-primary" style={{ width: `${dur ? (pos / dur) * 100 : 0}%` }} />
      </div>
      {delta !== null && Math.abs(delta) >= 1 && (
        <p className="text-xs text-muted">
          Volume ajustado em {delta > 0 ? "+" : ""}
          {delta.toFixed(1)} dB para o padrão das redes.
        </p>
      )}
    </div>
  );
}
