"use client";

import { useEffect, useState } from "react";
import { RotateCcw } from "lucide-react";
import type { Piece } from "@/lib/dsp/drums/detect";
import type { LoadedMedia } from "@/lib/media/load";

export type DrumTweaks = { kick: number; snare: number; toms: number; cymbals: number; sample_mix: number; room: number };

const SLIDERS: { key: keyof DrumTweaks; label: string; min: number; max: number; unit: string }[] = [
  { key: "kick", label: "Bumbo", min: -12, max: 12, unit: "dB" },
  { key: "snare", label: "Caixa", min: -12, max: 12, unit: "dB" },
  { key: "toms", label: "Tons", min: -12, max: 12, unit: "dB" },
  { key: "cymbals", label: "Pratos", min: -12, max: 12, unit: "dB" },
  { key: "sample_mix", label: "Som de estúdio", min: 0, max: 100, unit: "%" },
  { key: "room", label: "Sala", min: 0, max: 100, unit: "%" },
];

/** Valores do preset (drum_studio) para começar os controles. */
export function drumDefaults(params: Record<string, unknown>): DrumTweaks {
  const num = (v: unknown, d: number) => (typeof v === "number" ? v : typeof (v as { value?: number })?.value === "number" ? (v as { value: number }).value : d);
  return {
    kick: num(params.kick, 0),
    snare: num(params.snare, 0),
    toms: num(params.toms, 0),
    cymbals: num(params.cymbals, 0),
    sample_mix: num(params.sample_mix, 60),
    room: num(params.room, 30),
  };
}

const LABEL: Record<Piece, string> = { kick: "bumbos", snare: "caixas", tom: "tons", cymbal: "pratos/chimbal" };

export function DrumPanel({
  media,
  value,
  defaults,
  onChange,
}: {
  media: LoadedMedia;
  value: DrumTweaks;
  defaults: DrumTweaks;
  onChange: (v: DrumTweaks) => void;
}) {
  const [counts, setCounts] = useState<Record<Piece, number> | null>(null);

  // contagem das peças no arquivo inteiro (roda depois de pintar a tela)
  useEffect(() => {
    let alive = true;
    const t = setTimeout(async () => {
      const { detectDrums } = await import("@/lib/dsp/drums/detect");
      const r = detectDrums(media.channels, media.sampleRate);
      if (alive) setCounts(r.counts);
    }, 300);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [media]);

  const changed = SLIDERS.some((s) => value[s.key] !== defaults[s.key]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-lg font-semibold">Ajuste fino da bateria</h2>
          <p className="text-xs text-muted">
            {counts
              ? `Encontramos ${(Object.keys(LABEL) as Piece[])
                  .filter((p) => counts[p] > 0)
                  .map((p) => `${counts[p]} ${LABEL[p]}`)
                  .join(", ") || "poucas batidas — confira se o arquivo é de bateria"}.`
              : "Identificando as peças da bateria…"}
          </p>
        </div>
        {changed && (
          <button type="button" onClick={() => onChange(defaults)} className="flex items-center gap-1 text-xs text-muted hover:text-text">
            <RotateCcw className="size-3.5" /> Padrão
          </button>
        )}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {SLIDERS.map((s) => (
          <label key={s.key} className="flex flex-col gap-1 text-xs text-muted">
            <span className="flex justify-between">
              {s.label}
              <span className="tabular-nums text-text">
                {s.unit === "dB" && value[s.key] > 0 ? "+" : ""}
                {value[s.key]} {s.unit}
              </span>
            </span>
            <input
              type="range"
              min={s.min}
              max={s.max}
              step={s.unit === "dB" ? 0.5 : 5}
              value={value[s.key]}
              onChange={(e) => onChange({ ...value, [s.key]: Number(e.target.value) })}
              className="accent-violet-500"
            />
          </label>
        ))}
      </div>
      <p className="text-xs text-subtle">
        O app reforça cada bumbo, caixa e tom com o timbre do estilo, na mesma força da sua batida. Pratos e o ambiente vêm da
        sua gravação.
      </p>
    </div>
  );
}

/** Aplica os ajustes na cadeia do preset (mantendo o resto igual). */
export function withDrumTweaks<T extends { chain: { type: string; params?: Record<string, unknown> }[] }>(doc: T, t: DrumTweaks | null): T {
  if (!t) return doc;
  return {
    ...doc,
    chain: doc.chain.map((m) =>
      m.type === "drum_studio"
        ? {
            ...m,
            params: {
              ...m.params,
              kick: t.kick,
              snare: t.snare,
              toms: t.toms,
              cymbals: t.cymbals,
              sample_mix: { value: t.sample_mix, neutral: 0 },
              room: { value: t.room, neutral: 0 },
            },
          }
        : m,
    ),
  };
}
