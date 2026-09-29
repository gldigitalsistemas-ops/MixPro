"use client";

import { useState } from "react";
import { Captions, Download, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Chip, ProgressBar } from "@/components/ui/misc";
import { useToast } from "@/components/ui/toast";
import {
  CAPTION_STYLES,
  allWords,
  buildCaptions,
  captionText,
  editCaption,
  toSrt,
  type Caption,
  type CaptionPosition,
  type CaptionStyleId,
} from "@/lib/captions/model";
import { transcribe, type AsrModel, type TranscribeProgress } from "@/lib/captions/transcribe";
import type { LoadedMedia } from "@/lib/media/load";
import { cn, formatDuration } from "@/lib/cn";

export type CaptionState = {
  captions: Caption[];
  style: CaptionStyleId;
  position: CaptionPosition;
  burnIn: boolean;
};

const LANGUAGES = [
  { value: "portuguese", label: "Português" },
  { value: "english", label: "Inglês" },
  { value: "spanish", label: "Espanhol" },
  { value: "auto", label: "Detectar" },
];

const MODELS: { value: AsrModel; label: string; hint: string }[] = [
  { value: "rapida", label: "Rápida", hint: "77 MB · ideal no celular" },
  { value: "precisa", label: "Mais precisa", hint: "250 MB · melhor no computador" },
];

const POSITIONS: { value: CaptionPosition; label: string }[] = [
  { value: "top", label: "Em cima" },
  { value: "middle", label: "No meio" },
  { value: "bottom", label: "Embaixo" },
];

export function CaptionsPanel({
  media,
  value,
  onChange,
  defaults,
  mapTime,
}: {
  media: LoadedMedia;
  value: CaptionState | null;
  onChange: (v: CaptionState | null) => void;
  /** Estilo/posição preferidos (de "Meu estilo") para quando as legendas forem geradas. */
  defaults?: { style: CaptionStyleId; position: CaptionPosition } | null;
  /** Com cortes de pausas, converte o tempo do original para o do arquivo final (para o .srt). */
  mapTime?: ((t: number) => number | null) | null;
}) {
  const toast = useToast();
  const [language, setLanguage] = useState("portuguese");
  const [model, setModel] = useState<AsrModel>("rapida");
  const [progress, setProgress] = useState<TranscribeProgress | null>(null);

  async function generate() {
    setProgress({ stage: "download", value: 0 });
    try {
      const words = await transcribe(media.channels, media.sampleRate, { model, language }, setProgress);
      if (!words.length) {
        toast.info("Não encontramos fala neste arquivo.");
        return;
      }
      const style = value?.style ?? defaults?.style ?? "destaque";
      onChange({
        captions: buildCaptions(words, style),
        style,
        position: value?.position ?? defaults?.position ?? "bottom",
        burnIn: media.kind === "video",
      });
    } catch {
      toast.error("Não foi possível gerar as legendas. Verifique a internet (o modelo é baixado na primeira vez).");
    } finally {
      setProgress(null);
    }
  }

  function downloadSrt() {
    if (!value) return;
    const captions = mapTime ? remap(value.captions, mapTime) : value.captions;
    const blob = new Blob([toSrt(captions)], { type: "application/x-subrip" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${media.file.name.replace(/\.[^.]+$/, "")}.srt`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  if (progress) {
    const label =
      progress.stage === "download"
        ? `Baixando a IA de legendas (só na primeira vez)… ${Math.round(progress.value * 100)}%`
        : `Ouvindo e escrevendo as falas… ${Math.round(progress.value * 100)}%`;
    return (
      <div className="flex flex-col gap-2" aria-live="polite">
        <p className="text-sm">{label}</p>
        <ProgressBar value={progress.value * 100} label={label} />
        <p className="text-xs text-subtle">Tudo roda no seu aparelho. Você pode continuar ouvindo os presets.</p>
      </div>
    );
  }

  if (!value) {
    return (
      <div className="flex flex-col gap-4">
        <p className="text-sm text-muted">
          A IA escuta o seu vídeo e escreve as legendas palavra por palavra, no estilo dos Reels e TikTok.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1.5 text-xs text-muted">
            Idioma da fala
            <select
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
              className="h-10 rounded-xl border border-border-strong bg-black/20 px-3 text-sm text-text outline-none focus:border-violet-400"
            >
              {LANGUAGES.map((l) => (
                <option key={l.value} value={l.value}>
                  {l.label}
                </option>
              ))}
            </select>
          </label>
          <div className="flex flex-col gap-1.5 text-xs text-muted">
            Qualidade
            <div className="grid grid-cols-2 gap-1 rounded-xl border border-border-strong p-1">
              {MODELS.map((m) => (
                <button
                  key={m.value}
                  type="button"
                  aria-pressed={model === m.value}
                  onClick={() => setModel(m.value)}
                  title={m.hint}
                  className={cn(
                    "rounded-lg py-1.5 text-xs font-medium transition",
                    model === m.value ? "bg-brand text-white" : "text-muted hover:text-text",
                  )}
                >
                  {m.label}
                </button>
              ))}
            </div>
            <span className="text-[11px] text-subtle">{MODELS.find((m) => m.value === model)?.hint}</span>
          </div>
        </div>
        <Button onClick={generate} className="w-full">
          <Captions className="size-4" /> Gerar legendas automáticas
        </Button>
      </div>
    );
  }

  const update = (patch: Partial<CaptionState>) => onChange({ ...value, ...patch });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <span className="text-xs text-muted">Estilo</span>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {(Object.keys(CAPTION_STYLES) as CaptionStyleId[]).map((id) => (
            <button
              key={id}
              type="button"
              aria-pressed={value.style === id}
              onClick={() => update({ style: id, captions: buildCaptions(allWords(value.captions), id) })}
              className={cn(
                "flex flex-col items-center rounded-xl border px-2 py-2 text-xs transition",
                value.style === id ? "border-violet-400 bg-primary/15" : "border-border hover:bg-white/5",
              )}
            >
              <span className="font-semibold">{CAPTION_STYLES[id].label}</span>
              <span className="text-[10px] text-muted">{CAPTION_STYLES[id].hint}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted">Posição</span>
        {POSITIONS.map((p) => (
          <Chip key={p.value} active={value.position === p.value} onClick={() => update({ position: p.value })}>
            {p.label}
          </Chip>
        ))}
      </div>

      {media.kind === "video" && (
        <label className="flex cursor-pointer items-center gap-3 rounded-2xl border border-border p-3 text-sm">
          <input
            type="checkbox"
            checked={value.burnIn}
            onChange={(e) => update({ burnIn: e.target.checked })}
            className="size-4 accent-violet-500"
          />
          Gravar as legendas no vídeo
        </label>
      )}

      <details className="rounded-2xl border border-border">
        <summary className="cursor-pointer px-3 py-2.5 text-sm">
          Revisar texto ({value.captions.length} legendas)
        </summary>
        <ul className="flex max-h-72 flex-col gap-1.5 overflow-y-auto p-3 pt-0">
          {value.captions.map((c, i) => (
            <li key={`${c.start}-${i}`} className="flex items-center gap-2">
              <span className="w-10 shrink-0 text-[11px] tabular-nums text-subtle">{formatDuration(c.start)}</span>
              <input
                defaultValue={captionText(c)}
                onBlur={(e) => {
                  if (e.target.value === captionText(c)) return;
                  const captions = value.captions.slice();
                  captions[i] = editCaption(c, e.target.value);
                  update({ captions });
                }}
                aria-label={`Legenda em ${formatDuration(c.start)}`}
                className="h-9 min-w-0 flex-1 rounded-lg border border-border bg-black/20 px-2 text-sm outline-none focus:border-violet-400"
              />
            </li>
          ))}
        </ul>
      </details>

      <div className="grid grid-cols-2 gap-2">
        <Button variant="secondary" size="sm" onClick={downloadSrt}>
          <Download className="size-4" /> Baixar .srt
        </Button>
        <Button variant="ghost" size="sm" onClick={() => onChange(null)}>
          <RotateCcw className="size-4" /> Refazer
        </Button>
      </div>
    </div>
  );
}

/** Leva as legendas para a linha do tempo do arquivo cortado (palavras cortadas somem). */
function remap(captions: Caption[], map: (t: number) => number | null): Caption[] {
  return captions
    .map((c) => {
      const words = c.words.flatMap((w) => {
        const start = map(w.start);
        const end = map(Math.max(w.start, w.end - 0.001));
        return start === null || end === null ? [] : [{ ...w, start, end: Math.max(end, start + 0.05) }];
      });
      return words.length ? { start: words[0].start, end: words[words.length - 1].end, words } : null;
    })
    .filter((c): c is Caption => c !== null);
}
