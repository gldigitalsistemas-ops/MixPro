"use client";

import { useState } from "react";
import { ChevronDown, RotateCcw, Wand2 } from "lucide-react";
import { INSTRUMENT_LABEL, KIND_LABEL, SOURCE_LABEL, type AutoSetup } from "@/lib/auto-setup";
import type { InstrumentGuess, InstrumentType, RecordingSource } from "@/lib/dsp/analyze";
import { cn } from "@/lib/cn";

/** Cartão "Ajuste automático": o que o app encontrou no arquivo e o que já aplicou. */
export function AutoSetupCard({
  setup,
  applied,
  onReset,
  imageNotes,
  instrument,
  onInstrument,
}: {
  setup: AutoSetup;
  applied: boolean;
  onReset: () => void;
  /** O que a correção automática fez na imagem (vídeo). */
  imageNotes?: string[] | null;
  /** Instrumento e gravação em uso (marcados no seletor). */
  instrument?: InstrumentGuess | null;
  onInstrument?: (g: InstrumentGuess) => void;
}) {
  const [open, setOpen] = useState(true);
  return (
    <div className="rounded-2xl border border-violet-400/30 bg-primary/10 p-3">
      <button type="button" onClick={() => setOpen(!open)} className="flex w-full items-center gap-3 text-left" aria-expanded={open}>
        <span className="bg-brand grid size-9 shrink-0 place-items-center rounded-xl text-white">
          <Wand2 className="size-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold">
            {applied ? "Ajuste automático aplicado" : "Ajuste automático"} · detectamos {KIND_LABEL[setup.kind]}
          </span>
          <span className="block text-xs text-muted">
            {applied ? "Já está tocando na prévia. Mude o que quiser." : "Você mudou as escolhas; dá para voltar ao automático."}
          </span>
        </span>
        <ChevronDown className={cn("size-4 shrink-0 text-muted transition", open && "rotate-180")} />
      </button>
      {open && (
        <div className="mt-3 flex flex-col gap-2 pl-12">
          <ul className="flex list-disc flex-col gap-1 pl-4 text-xs text-muted">
            {setup.notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
            {imageNotes && <li>Imagem: {imageNotes.length ? `${imageNotes.join(", ")}.` : "já estava equilibrada; mexemos pouco."} Filtros na aba Vídeo.</li>}
            {setup.unsure &&<li>Não temos certeza do tipo de som: se não for {KIND_LABEL[setup.kind]}, escolha a categoria certa abaixo.</li>}
          </ul>
          {instrument && onInstrument && (
            <div className="flex flex-col gap-2 pt-1">
              <Segmented
                label="Qual instrumento?"
                options={Object.entries(INSTRUMENT_LABEL) as [InstrumentType, string][]}
                value={instrument.type}
                onChange={(type) => onInstrument({ ...instrument, type })}
              />
              <Segmented
                label="Como gravou?"
                options={Object.entries(SOURCE_LABEL) as [RecordingSource, string][]}
                value={instrument.source}
                onChange={(source) => onInstrument({ ...instrument, source })}
              />
            </div>
          )}
          {!applied && (
            <button type="button" onClick={onReset} className="flex items-center gap-1 self-start text-xs font-medium text-violet-200 hover:text-white">
              <RotateCcw className="size-3.5" /> Voltar ao ajuste automático
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: [T, string][];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs font-medium text-text">{label}</span>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label={label}>
        {options.map(([v, l]) => (
          <button
            key={v}
            type="button"
            aria-pressed={value === v}
            onClick={() => onChange(v)}
            className={cn(
              "rounded-full border px-3 py-1 text-xs font-medium transition",
              value === v ? "border-violet-400 bg-primary/25 text-white" : "border-border text-muted hover:text-text",
            )}
          >
            {l}
          </button>
        ))}
      </div>
    </div>
  );
}
