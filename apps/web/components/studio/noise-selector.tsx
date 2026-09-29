"use client";

import { cn } from "@/lib/cn";

export type NoiseLevel = "off" | "light" | "strong";

/** Proporção do sinal limpo: "Reduzir" mantém um pouco do ambiente para soar natural. */
export const NOISE_AMOUNT: Record<NoiseLevel, number> = { off: 0, light: 0.9, strong: 1 };

const OPTIONS: { value: NoiseLevel; label: string; hint: string }[] = [
  { value: "off", label: "Manter", hint: "Som original" },
  { value: "light", label: "Reduzir", hint: "Natural" },
  { value: "strong", label: "Remover", hint: "Máximo" },
];

export function NoiseSelector({ value, onChange }: { value: NoiseLevel; onChange: (v: NoiseLevel) => void }) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1 text-sm font-medium">Ruído de fundo</legend>
      <p className="mb-2 text-xs text-muted">Ventilador, ar-condicionado, rua, chiado. Funciona melhor em voz.</p>
      <div className="grid grid-cols-3 gap-1 rounded-2xl border border-border-strong p-1">
        {OPTIONS.map((o) => (
          <button
            key={o.value}
            type="button"
            aria-pressed={value === o.value}
            onClick={() => onChange(o.value)}
            className={cn(
              "flex flex-col items-center rounded-xl py-2 text-xs transition",
              value === o.value ? "bg-brand text-white" : "text-muted hover:bg-white/5 hover:text-text",
            )}
          >
            <span className="font-semibold">{o.label}</span>
            <span className="text-[10px] opacity-80">{o.hint}</span>
          </button>
        ))}
      </div>
    </fieldset>
  );
}
