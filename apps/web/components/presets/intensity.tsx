"use client";

import { INTENSITIES, type Intensity } from "@mixpro/contracts";
import { cn } from "@/lib/cn";

const LABEL: Record<Intensity, string> = { 25: "Sutil", 50: "Normal", 75: "Evidente", 100: "Intenso" };

export function IntensitySelector({
  value,
  onChange,
  disabled,
}: {
  value: Intensity;
  onChange: (v: Intensity) => void;
  disabled?: boolean;
}) {
  return (
    <fieldset className="flex flex-col gap-2" disabled={disabled}>
      <legend className="mb-2 text-sm font-medium">Intensidade</legend>
      <div className="grid grid-cols-4 gap-1 rounded-2xl border border-border-strong p-1">
        {INTENSITIES.map((i) => (
          <button
            key={i}
            type="button"
            aria-pressed={value === i}
            onClick={() => onChange(i)}
            className={cn(
              "flex flex-col items-center rounded-xl py-2 text-xs transition disabled:opacity-50",
              value === i ? "bg-brand text-white" : "text-muted hover:bg-white/5 hover:text-text",
            )}
          >
            <span className="font-semibold">{i}%</span>
            <span className="text-[10px] opacity-80">{LABEL[i]}</span>
          </button>
        ))}
      </div>
    </fieldset>
  );
}
