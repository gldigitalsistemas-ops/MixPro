"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { Pause, Play, Repeat, Volume2 } from "lucide-react";
import { ABEngine, loadBuffer } from "@/lib/audio/ab-engine";
import { Waveform } from "@/components/audio/waveform";
import { cn, formatDuration } from "@/lib/cn";

export type ABSource = {
  /** Chave estável p/ cache (id do arquivo). */
  id: string;
  url: string;
  peaks: number[] | null;
  lufs: number | null;
};

type Props = {
  original: ABSource | null;
  processed: ABSource | null;
  processedLabel?: string;
  busy?: boolean;
  offsetSeconds?: number;
};

function useEngine(engine: ABEngine) {
  const subscribe = (cb: () => void) => engine.subscribe(cb);
  // Snapshot composto p/ re-render quando qualquer estado relevante muda
  const snap = () => `${engine.playing}|${engine.side}|${engine.levelMatch}|${engine.volume}|${engine.hasB}|${engine.duration}`;
  useSyncExternalStore(subscribe, snap, () => "");
}

export function ABPlayer({ original, processed, processedLabel = "Processado", busy, offsetSeconds = 0 }: Props) {
  const [engine] = useState(() => new ABEngine());
  useEngine(engine);

  const [time, setTime] = useState(0);
  const sourceKey = original ? `${original.id}|${processed?.id ?? ""}` : null;
  const [loaded, setLoaded] = useState<{ key: string | null; error: string | null }>({ key: null, error: null });
  const loading = sourceKey !== null && loaded.key !== sourceKey;
  const error = loaded.key === sourceKey ? loaded.error : null;

  // Carrega buffers quando as fontes mudam (mantém posição de reprodução)
  useEffect(() => {
    if (!original || !sourceKey) return;
    let cancelled = false;
    Promise.all([
      loadBuffer(original.id, original.url),
      processed ? loadBuffer(processed.id, processed.url) : Promise.resolve(null),
    ])
      .then(([a, b]) => {
        if (cancelled) return;
        engine.setBuffers(a, b);
        setLoaded({ key: sourceKey, error: null });
      })
      .catch(() => !cancelled && setLoaded({ key: sourceKey, error: "Não foi possível carregar o áudio. Verifique sua conexão." }));
    return () => {
      cancelled = true;
    };
  }, [sourceKey]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => engine.dispose(), [engine]);

  // Relógio da UI
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      setTime(engine.currentTime());
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [engine]);

  // Atalhos: espaço = play/pause, A/B = lado, Tab-livre
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t && ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName)) return;
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
    return Math.pow(10, (original.lufs - processed.lufs) / 20);
  }, [original?.lufs, processed?.lufs]);

  const duration = engine.duration;
  const progress = duration > 0 ? time / duration : 0;
  const showB = engine.side === "B" && engine.hasB;
  const peaks = showB ? processed?.peaks : original?.peaks;

  return (
    <div className="flex flex-col gap-4">
      <div className="relative rounded-2xl bg-black/25 p-3">
        <div className="mb-2 flex items-center justify-between text-xs text-muted">
          <span className={cn("font-medium", showB ? "text-violet-300" : "text-blue-300")}>
            {showB ? processedLabel : "Original"}
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
          height={84}
          ariaLabel="Posição da reprodução"
        />
        {(loading || busy) && (
          <div className="absolute inset-0 grid place-items-center rounded-2xl bg-bg/50 text-sm text-muted backdrop-blur-[2px]">
            {busy ? "Processando preview…" : "Carregando áudio…"}
          </div>
        )}
      </div>

      {error && <p className="text-sm text-red-300">{error}</p>}

      <div className="flex items-center gap-3">
        <button
          onClick={() => engine.toggle()}
          disabled={!original || loading}
          aria-label={engine.playing ? "Pausar" : "Tocar"}
          className="bg-brand grid size-14 shrink-0 place-items-center rounded-full text-white shadow-[0_8px_30px_-6px_rgb(124_58_237/0.7)] transition hover:brightness-110 disabled:opacity-50"
        >
          {engine.playing ? <Pause className="size-6" /> : <Play className="size-6 translate-x-0.5" />}
        </button>

        <div className="grid flex-1 grid-cols-2 rounded-2xl border border-border-strong p-1" role="group" aria-label="Comparar A/B">
          {(["A", "B"] as const).map((s) => (
            <button
              key={s}
              onClick={() => engine.setSide(s)}
              disabled={s === "B" && !engine.hasB}
              aria-pressed={engine.side === s}
              className={cn(
                "flex h-11 flex-col items-center justify-center rounded-xl text-xs font-semibold transition disabled:opacity-40",
                engine.side === s ? (s === "A" ? "bg-blue/20 text-blue-200" : "bg-primary/25 text-violet-200") : "text-muted hover:text-text",
              )}
            >
              <span className="text-sm">{s}</span>
              <span className="text-[10px] font-normal opacity-80">{s === "A" ? "Original" : processedLabel}</span>
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
        <label className="flex cursor-pointer items-center gap-2" title="Compensa a diferença de volume para comparar só a sonoridade">
          <input
            type="checkbox"
            checked={engine.levelMatch}
            disabled={!engine.hasB || matchGain === 1}
            onChange={(e) => engine.setLevelMatch(e.target.checked, matchGain)}
            className="accent-violet-500"
          />
          Comparar no mesmo volume
        </label>
        <span className="flex items-center gap-1">
          <Repeat className="size-3.5" aria-hidden /> Repetição ativa
        </span>
        <span className="hidden md:inline">Atalhos: espaço, A, B</span>
      </div>
    </div>
  );
}
