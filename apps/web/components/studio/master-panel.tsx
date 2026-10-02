"use client";

import { Check } from "lucide-react";
import { cn } from "@/lib/cn";
import type { StudioPreset } from "@/lib/presets";

/**
 * Masterização no fim da mixagem (opcional): volume, brilho e punch no padrão das plataformas
 * sobre o que o usuário mixou. "Sem master" deixa o som exatamente como está.
 */
export function MasterPanel({ masters, value, onChange }: { masters: StudioPreset[]; value: string | null; onChange: (id: string | null) => void }) {
  if (!masters.length) return null;
  const options: { id: string | null; name: string; description: string }[] = [
    { id: null, name: "Sem master", description: "Já gostei do som: fica exatamente como estou ouvindo." },
    ...masters.map((m) => ({ id: m.id, name: m.name, description: m.description ?? "" })),
  ];
  return (
    <div className="flex flex-col gap-3">
      <div>
        <h2 className="font-display text-lg font-semibold">Masterização (opcional)</h2>
        <p className="text-xs text-muted">O toque final sobre a sua mixagem: volume, brilho e punch no padrão das plataformas.</p>
      </div>
      <ul className="grid gap-2 sm:grid-cols-2">
        {options.map((o) => {
          const selected = value === o.id;
          return (
            <li key={o.id ?? "none"}>
              <button
                type="button"
                aria-pressed={selected}
                onClick={() => onChange(o.id)}
                className={cn(
                  "flex h-full w-full items-start gap-3 rounded-2xl border p-3 text-left transition",
                  selected ? "border-violet-400 bg-primary/12" : "border-border hover:bg-white/[0.04]",
                )}
              >
                <span className={cn("mt-0.5 grid size-5 shrink-0 place-items-center rounded-full border", selected ? "border-violet-300 bg-violet-500" : "border-border-strong")}>
                  {selected && <Check className="size-3 text-white" />}
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-semibold">{o.name}</span>
                  <span className="line-clamp-2 text-xs text-muted">{o.description}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
