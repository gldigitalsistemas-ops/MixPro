"use client";

import { useRef, useState } from "react";
import { Music2, X } from "lucide-react";
import { Chip, ProgressBar } from "@/components/ui/misc";
import { useToast } from "@/components/ui/toast";
import { loadMedia, MediaLoadError } from "@/lib/media/load";
import { prepareMusic, type MusicLevel } from "@/lib/media/music";
import type { Signal } from "@/lib/dsp/types";

export type MusicState = { name: string; channels: Signal; level: MusicLevel };

const LEVELS: { value: MusicLevel; label: string }[] = [
  { value: "baixa", label: "Baixa" },
  { value: "media", label: "Média" },
  { value: "alta", label: "Alta" },
];

export function MusicPicker({
  sampleRate,
  channels,
  value,
  onChange,
}: {
  sampleRate: number;
  channels: number;
  value: MusicState | null;
  onChange: (v: MusicState | null) => void;
}) {
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [loading, setLoading] = useState<number | null>(null);

  async function pick(file: File | undefined) {
    if (!file) return;
    setLoading(0);
    try {
      const m = await loadMedia(file, (p) => setLoading(p * 100));
      onChange({
        name: file.name.replace(/\.[^.]+$/, ""),
        channels: prepareMusic({ name: file.name, channels: m.channels, sampleRate: m.sampleRate }, sampleRate, channels),
        level: value?.level ?? "media",
      });
    } catch (err) {
      toast.error(err instanceof MediaLoadError ? err.message : "Não foi possível abrir essa música.");
    } finally {
      setLoading(null);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div>
        <h2 className="font-display text-lg font-semibold">Música de fundo</h2>
        <p className="text-xs text-muted">Ela abaixa sozinha quando você fala e volta nas pausas, com entrada e saída suaves.</p>
      </div>
      <input
        ref={input}
        type="file"
        accept="audio/*,.mp3,.m4a,.wav,.aac,.ogg"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          void pick(f);
        }}
      />
      {loading !== null ? (
        <ProgressBar value={loading} label="Lendo a música" />
      ) : value ? (
        <>
          <div className="flex items-center gap-3 rounded-2xl border border-border p-3">
            <Music2 className="size-5 shrink-0 text-violet-300" />
            <span className="min-w-0 flex-1 truncate text-sm">{value.name}</span>
            <button type="button" aria-label="Remover música" onClick={() => onChange(null)} className="rounded-full p-1.5 text-muted hover:bg-white/5">
              <X className="size-4" />
            </button>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted">Volume</span>
            {LEVELS.map((l) => (
              <Chip key={l.value} active={value.level === l.value} onClick={() => onChange({ ...value, level: l.value })}>
                {l.label}
              </Chip>
            ))}
          </div>
        </>
      ) : (
        <button
          type="button"
          onClick={() => input.current?.click()}
          className="flex items-center gap-3 rounded-2xl border border-dashed border-border-strong p-3 text-left text-sm hover:border-violet-400/60"
        >
          <Music2 className="size-5 shrink-0 text-violet-300" />
          <span>
            Escolher uma música
            <span className="block text-xs text-muted">
              Use músicas que você pode usar: sua própria, da Biblioteca de Áudio do YouTube ou sem direitos autorais.
            </span>
          </span>
        </button>
      )}
    </div>
  );
}
