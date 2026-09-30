"use client";

import { useState } from "react";
import { Save, SlidersHorizontal, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ChainDoc } from "@/lib/dsp/chain";
import type { StudioPreset } from "@/lib/presets";
import type { CabIR } from "@/lib/drums/library";
import { PresetCustomizer } from "./preset-customizer";

/** "Personalizar": abre a cadeia do preset para o usuário mexer e salvar em "Meus presets". */
export function CustomizePanel({
  preset,
  chain,
  onStart,
  onChange,
  onDiscard,
  onSave,
  irs = [],
}: {
  preset: StudioPreset;
  /** Cadeia em edição (null = ainda não personalizando). */
  chain: ChainDoc | null;
  onStart: () => void;
  onChange: (c: ChainDoc) => void;
  onDiscard: () => void;
  onSave: (name: string) => Promise<boolean>;
  /** Caixas gravadas (IR) disponíveis para o amplificador. */
  irs?: CabIR[];
}) {
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);

  if (!chain) {
    return (
      <button type="button" onClick={onStart} className="flex w-full items-center gap-3 text-left">
        <span className="bg-brand grid size-10 shrink-0 place-items-center rounded-xl text-white">
          <SlidersHorizontal className="size-5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block font-semibold">Personalizar este preset</span>
          <span className="block text-xs text-muted">
            Mexa em cada ajuste — amplificador, EQ, compressor, delay, reverb — e salve como seu.
          </span>
        </span>
      </button>
    );
  }

  const suggested = preset.userPresetId ? preset.name : `Meu ${preset.name}`.slice(0, 40);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-lg font-semibold">Personalizando</h2>
          <p className="text-xs text-muted">Base: {preset.name}. Você ouve cada mudança na prévia.</p>
        </div>
        <button type="button" onClick={onDiscard} className="flex shrink-0 items-center gap-1 text-xs text-muted hover:text-text">
          <X className="size-3.5" /> Descartar
        </button>
      </div>
      <PresetCustomizer chain={chain} irs={irs} onChange={onChange} />
      <form
        className="flex flex-col gap-2 rounded-2xl border border-border p-3 sm:flex-row"
        onSubmit={async (e) => {
          e.preventDefault();
          setSaving(true);
          const ok = await onSave((name.trim() || suggested).slice(0, 40));
          setSaving(false);
          if (ok) setName("");
        }}
      >
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={suggested}
          maxLength={40}
          aria-label="Nome do preset"
          className="h-10 min-w-0 flex-1 rounded-xl border border-border-strong bg-black/20 px-3 text-sm outline-none focus:border-violet-400"
        />
        <Button type="submit" loading={saving}>
          <Save className="size-4" /> Salvar em Meus presets
        </Button>
      </form>
    </div>
  );
}
