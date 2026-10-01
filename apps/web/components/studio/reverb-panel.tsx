"use client";

import { RotateCcw } from "lucide-react";
import type { ReverbSize, ReverbTweak } from "@/lib/reverb-tweak";
import { cn } from "@/lib/cn";

const SIZES: { value: ReverbSize; label: string; hint: string }[] = [
  { value: "small", label: "Small", hint: "sala pequena" },
  { value: "medium", label: "Médio", hint: "estúdio" },
  { value: "large", label: "Large", hint: "igreja / arena" },
];

/** Reverb de qualquer preset: tamanho do ambiente e quantidade. */
export function ReverbPanel({ value, defaults, onChange }: { value: ReverbTweak; defaults: ReverbTweak; onChange: (v: ReverbTweak) => void }) {
  const changed = value.size !== defaults.size || value.amount !== defaults.amount;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-lg font-semibold">Reverb</h2>
          <p className="text-xs text-muted">Ambiente do som: de sala pequena a igreja. Zero = sem reverb.</p>
        </div>
        {changed && (
          <button type="button" onClick={() => onChange(defaults)} className="flex shrink-0 items-center gap-1 text-xs text-muted hover:text-text">
            <RotateCcw className="size-3.5" /> Padrão
          </button>
        )}
      </div>
      <div className="grid grid-cols-3 gap-1 rounded-xl border border-border-strong p-1" role="group" aria-label="Tamanho do reverb">
        {SIZES.map((s) => (
          <button
            key={s.value}
            type="button"
            aria-pressed={value.size === s.value}
            onClick={() => onChange({ ...value, size: s.value, amount: value.amount || 25 })}
            className={cn(
              "flex flex-col items-center rounded-lg py-1.5 text-xs font-semibold transition",
              value.size === s.value ? "bg-brand text-white" : "text-muted hover:text-text",
            )}
          >
            {s.label}
            <span className="text-[10px] font-normal opacity-80">{s.hint}</span>
          </button>
        ))}
      </div>
      <label className="flex flex-col gap-1 text-xs text-muted">
        <span className="flex justify-between">
          Quantidade de reverb
          <span className="tabular-nums text-text">{value.amount === 0 ? "sem reverb" : `${value.amount} %`}</span>
        </span>
        <input
          type="range"
          min={0}
          max={100}
          step={5}
          value={value.amount}
          onChange={(e) => onChange({ ...value, amount: Number(e.target.value) })}
          aria-label="Quantidade de reverb"
          className="accent-violet-500"
        />
      </label>
    </div>
  );
}
