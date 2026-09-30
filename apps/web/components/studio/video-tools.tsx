"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ImagePlus, X } from "lucide-react";
import { Chip } from "@/components/ui/misc";
import { useToast } from "@/components/ui/toast";
import { ensureCaptionFont } from "@/lib/captions/font";
import { cn, formatDuration } from "@/lib/cn";
import {
  PALETTES,
  composeAudiogram,
  composeFrame,
  envelope,
  outputSize,
  type AudiogramStyle,
  type Fit,
  type Look,
  type VideoFormat,
} from "@/lib/media/compose";
import { keptDuration, type CutLevel, type Segment } from "@/lib/media/cuts";
import type { LoadedMedia } from "@/lib/media/load";
import { DEFAULT_LOOK, FILTERS, type ColorLook } from "@/lib/media/color";
import { CoverMaker } from "./cover-maker";

export type VideoToolsState = {
  cut: CutLevel;
  format: VideoFormat;
  fit: Fit;
  watermark: boolean;
  audiogram: AudiogramStyle | null;
  /** Tratamento de imagem (só vídeo). */
  color: ColorLook;
  /** Chamada no final do vídeo: texto (null = a primeira sugestão do nicho) e @ do perfil. */
  cta: { enabled: boolean; text: string | null; handle: string };
};

export const defaultVideoTools = (media: LoadedMedia): VideoToolsState => ({
  cut: "off",
  format: media.kind === "video" ? "original" : "9:16",
  fit: "blur",
  watermark: true,
  audiogram: null,
  color: { ...DEFAULT_LOOK },
  cta: { enabled: true, text: null, handle: storedHandle() },
});

const KEY_HANDLE = "mixpro.handle";
function storedHandle(): string {
  try {
    return localStorage.getItem(KEY_HANDLE) ?? "";
  } catch {
    return "";
  }
}

const FORMATS: { value: VideoFormat; label: string; hint: string }[] = [
  { value: "original", label: "Original", hint: "Como foi gravado" },
  { value: "9:16", label: "9:16", hint: "Reels, TikTok, Shorts" },
  { value: "1:1", label: "1:1", hint: "Feed quadrado" },
  { value: "4:5", label: "4:5", hint: "Feed do Instagram" },
  { value: "16:9", label: "16:9", hint: "YouTube" },
];

const CUTS: { value: CutLevel; label: string; hint: string }[] = [
  { value: "off", label: "Sem cortes", hint: "Mantém tudo" },
  { value: "suave", label: "Suave", hint: "Só pausas longas" },
  { value: "dinamico", label: "Dinâmico", hint: "Ritmo de Reels" },
];

function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string; hint?: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="grid gap-1 rounded-2xl border border-border-strong p-1" style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0,1fr))` }}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            "flex flex-col items-center rounded-xl px-1 py-2 text-xs transition",
            value === o.value ? "bg-brand text-white" : "text-muted hover:bg-white/5 hover:text-text",
          )}
        >
          <span className="font-semibold">{o.label}</span>
          {o.hint && <span className="text-[10px] opacity-80">{o.hint}</span>}
        </button>
      ))}
    </div>
  );
}

export function VideoTools({
  media,
  videoUrl,
  value,
  onChange,
  segments,
  hasWords,
  look,
  coverSuggestion,
  ctaOptions,
}: {
  media: LoadedMedia;
  videoUrl: string | null;
  value: VideoToolsState;
  onChange: (v: VideoToolsState) => void;
  segments: Segment[];
  hasWords: boolean;
  look: Look;
  /** Título sugerido para a capa (tirado da fala ou do nicho). */
  coverSuggestion: string;
  /** Chamadas sugeridas para o final (conforme o nicho). */
  ctaOptions: string[];
}) {
  const toast = useToast();
  const set = (patch: Partial<VideoToolsState>) => onChange({ ...value, ...patch });
  const isVideo = media.kind === "video";
  const kept = keptDuration(segments);
  const [time, setTime] = useState(Math.min(1, media.duration / 2));
  const canvas = useRef<HTMLCanvasElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const env = useMemo(() => (isVideo ? null : envelope(media.channels, media.sampleRate, 30)), [isVideo, media]);

  // prévia do quadro final (formato, enquadramento, legendas e selo)
  useEffect(() => {
    let cancelled = false;
    const draw = async () => {
      await ensureCaptionFont();
      const c = canvas.current;
      if (!c || cancelled) return;
      const v = video.current;
      const src = isVideo && v && v.videoWidth ? { w: v.videoWidth, h: v.videoHeight } : null;
      const size = src ? outputSize(src.w, src.h, value.format) : outputSize(1080, 1920, value.format === "original" ? "9:16" : value.format);
      const scale = 360 / Math.max(size.width, size.height);
      c.width = Math.round(size.width * scale);
      c.height = Math.round(size.height * scale);
      const ctx = c.getContext("2d")!;
      if (src && v) composeFrame(ctx, c.width, c.height, v, src.w, src.h, time, look);
      else if (env && value.audiogram) composeAudiogram(ctx, c.width, c.height, Math.floor(time * 30), env, time, value.audiogram, look);
    };
    void draw();
    const v = video.current;
    v?.addEventListener("seeked", draw);
    v?.addEventListener("loadeddata", draw);
    return () => {
      cancelled = true;
      v?.removeEventListener("seeked", draw);
      v?.removeEventListener("loadeddata", draw);
    };
  }, [time, look, value.format, value.audiogram, isVideo, env]);

  useEffect(() => {
    if (video.current && Math.abs(video.current.currentTime - time) > 0.01) video.current.currentTime = time;
  }, [time]);

  async function pickImage(file: File | undefined) {
    if (!file || !value.audiogram) return;
    try {
      const image = await createImageBitmap(file);
      set({ audiogram: { ...value.audiogram, image } });
    } catch {
      toast.error("Não foi possível abrir essa imagem.");
    }
  }

  return (
    <div className="flex flex-col gap-5">
      {!isVideo && !value.audiogram && (
        <button
          type="button"
          onClick={() => set({ audiogram: { palette: 0, title: "", image: null } })}
          className="flex items-center gap-3 rounded-2xl border border-violet-400/30 bg-primary/10 p-4 text-left"
        >
          <ImagePlus className="size-6 shrink-0 text-violet-300" />
          <span>
            <span className="block text-sm font-semibold">Transformar em vídeo (audiograma)</span>
            <span className="text-xs text-muted">Onda animada, título, foto e legendas: ótimo para divulgar podcast e música no Reels.</span>
          </span>
        </button>
      )}

      {!isVideo && value.audiogram && (
        <section className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium">Audiograma: seu áudio vira vídeo</h3>
            <button type="button" onClick={() => set({ audiogram: null })} className="text-xs text-muted hover:text-text">
              Não gerar vídeo
            </button>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {PALETTES.map(([c1, c2], i) => (
              <button
                key={i}
                type="button"
                aria-label={`Cor ${i + 1}`}
                aria-pressed={value.audiogram!.palette === i && !value.audiogram!.image}
                onClick={() => set({ audiogram: { ...value.audiogram!, palette: i, image: null } })}
                className={cn(
                  "size-9 rounded-full border-2",
                  value.audiogram!.palette === i && !value.audiogram!.image ? "border-white" : "border-transparent",
                )}
                style={{ background: `linear-gradient(135deg, ${c1}, ${c2})` }}
              />
            ))}
            <label className="flex h-9 cursor-pointer items-center gap-1.5 rounded-full border border-border-strong px-3 text-xs">
              <ImagePlus className="size-4" /> Foto de fundo
              <input type="file" accept="image/*" className="hidden" onChange={(e) => void pickImage(e.target.files?.[0])} />
            </label>
            {value.audiogram.image && (
              <button type="button" onClick={() => set({ audiogram: { ...value.audiogram!, image: null } })} className="text-xs text-muted">
                <X className="inline size-3" /> remover foto
              </button>
            )}
          </div>
          <input
            value={value.audiogram.title}
            onChange={(e) => set({ audiogram: { ...value.audiogram!, title: e.target.value.slice(0, 80) } })}
            placeholder="Título (ex.: Episódio 12 — Como começar)"
            className="h-10 rounded-xl border border-border-strong bg-black/20 px-3 text-sm outline-none focus:border-violet-400"
          />
        </section>
      )}

      {isVideo && <ImageSection value={value.color} onChange={(color) => set({ color })} />}

      <section className="flex flex-col gap-2">
        <h3 className="text-sm font-medium">Cortar pausas {hasWords && "e “é…”, “hã…”"}</h3>
        <Segmented options={CUTS} value={value.cut} onChange={(cut) => set({ cut })} />
        {value.cut !== "off" && (
          <p className="text-xs text-muted">
            {formatDuration(media.duration)} → <strong className="text-text">{formatDuration(kept)}</strong> ({formatDuration(media.duration - kept)} a menos
            {segments.length > 1 ? `, ${segments.length - 1} corte${segments.length > 2 ? "s" : ""}` : ""})
          </p>
        )}
        {!hasWords && value.cut !== "off" && (
          <p className="text-xs text-subtle">Dica: gere as legendas antes para cortar também os “é…” e “hã…”.</p>
        )}
      </section>

      {(isVideo || value.audiogram) && (
      <>
      <CtaSection
        value={value.cta}
        options={ctaOptions}
        onChange={(cta) => set({ cta })}
        onPreview={() => setTime(Math.max(0, media.duration - 1))}
      />

      <section className="flex flex-col gap-2">
        <h3 className="text-sm font-medium">Formato</h3>
        <Segmented options={isVideo ? FORMATS : FORMATS.slice(1)} value={value.format} onChange={(format) => set({ format })} />
        {isVideo && value.format !== "original" && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted">Enquadramento</span>
            <Chip active={value.fit === "blur"} onClick={() => set({ fit: "blur" })}>
              Fundo desfocado
            </Chip>
            <Chip active={value.fit === "crop"} onClick={() => set({ fit: "crop" })}>
              Recortar
            </Chip>
          </div>
        )}
      </section>

      <label className="flex cursor-pointer items-center gap-3 rounded-2xl border border-border p-3 text-sm">
        <input type="checkbox" checked={value.watermark} onChange={(e) => set({ watermark: e.target.checked })} className="size-4 accent-violet-500" />
        <span>
          Selo “Feito com Mix Pro”
          <span className="block text-xs text-muted">Discreto, no canto. Ajuda o Mix Pro a continuar grátis para testar.</span>
        </span>
      </label>

      <section className="flex flex-col gap-3">
        <h3 className="text-sm font-medium">Prévia do quadro</h3>
        <div className="flex justify-center rounded-2xl bg-black/40 p-3">
          <canvas ref={canvas} className="max-h-[360px] max-w-full rounded-lg" aria-label="Prévia do quadro final" />
        </div>
        {isVideo && videoUrl && <video ref={video} src={videoUrl} muted playsInline preload="auto" className="pointer-events-none absolute size-px opacity-0" aria-hidden />}
        <label className="flex items-center gap-3 text-xs text-muted">
          Momento
          <input
            type="range"
            min={0}
            max={Math.max(0.1, media.duration - 0.05)}
            step={0.05}
            value={time}
            onChange={(e) => setTime(Number(e.target.value))}
            className="flex-1 accent-violet-500"
          />
          <span className="w-10 tabular-nums">{formatDuration(time)}</span>
        </label>
        {isVideo && <CoverMaker media={media} look={look} suggestion={coverSuggestion} />}
      </section>
      </>
      )}
    </div>
  );
}

/** Chamada no final (CTA): sugestões conforme o vídeo, texto livre e o @ do perfil. */
function CtaSection({
  value,
  options,
  onChange,
  onPreview,
}: {
  value: VideoToolsState["cta"];
  options: string[];
  onChange: (v: VideoToolsState["cta"]) => void;
  onPreview: () => void;
}) {
  const text = value.text ?? options[0] ?? "";
  return (
    <section className="flex flex-col gap-2">
      <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-border p-3 text-sm">
        <input type="checkbox" checked={value.enabled} onChange={(e) => onChange({ ...value, enabled: e.target.checked })} className="mt-0.5 size-4 accent-violet-500" />
        <span>
          Chamada no final do vídeo (CTA)
          <span className="block text-xs text-muted">Nos últimos segundos aparece um cartão pedindo para comentar, seguir ou salvar. Aumenta o engajamento.</span>
        </span>
      </label>
      {value.enabled && (
        <>
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Sugestões de chamada">
            {options.map((o) => (
              <button
                key={o}
                type="button"
                aria-pressed={text === o}
                onClick={() => onChange({ ...value, text: o })}
                className={cn("rounded-full border px-3 py-1 text-xs", text === o ? "border-violet-400 bg-primary/20 text-text" : "border-border text-muted hover:text-text")}
              >
                {o}
              </button>
            ))}
          </div>
          <div className="grid gap-2 sm:grid-cols-[1fr_12rem]">
            <input
              value={text}
              onChange={(e) => onChange({ ...value, text: e.target.value.slice(0, 70) })}
              aria-label="Texto da chamada final"
              placeholder="Ex.: Comenta a próxima música 👇"
              className="h-10 rounded-xl border border-border-strong bg-black/20 px-3 text-sm outline-none focus:border-violet-400"
            />
            <input
              value={value.handle}
              onChange={(e) => {
                const raw = e.target.value.replace(/\s/g, "").slice(0, 31);
                const handle = raw && !raw.startsWith("@") ? `@${raw}` : raw;
                try {
                  localStorage.setItem(KEY_HANDLE, handle);
                } catch {}
                onChange({ ...value, handle });
              }}
              aria-label="Seu @ nas redes"
              placeholder="@seuperfil (opcional)"
              className="h-10 rounded-xl border border-border-strong bg-black/20 px-3 text-sm outline-none focus:border-violet-400"
            />
          </div>
          <button type="button" onClick={onPreview} className="self-start text-xs text-violet-200 hover:text-white">
            Ver na prévia do quadro ↓
          </button>
        </>
      )}
    </section>
  );
}

function LookSlider({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <label className="flex flex-col gap-1 text-xs text-muted">
      <span className="flex justify-between">
        {label}
        <span className="tabular-nums text-text">{value}%</span>
      </span>
      <input type="range" min={0} max={100} step={5} value={value} onChange={(e) => onChange(Number(e.target.value))} className="accent-violet-500" />
    </label>
  );
}

/** Imagem: correção automática (brilho, contraste, cor da luz) + filtro, nitidez e vinheta. */
function ImageSection({ value, onChange }: { value: ColorLook; onChange: (v: ColorLook) => void }) {
  const set = (patch: Partial<ColorLook>) => onChange({ ...value, ...patch });
  const notes = value.correction?.notes ?? [];
  return (
    <section className="flex flex-col gap-3">
      <h3 className="text-sm font-medium">Imagem</h3>
      <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-border p-3 text-sm">
        <input type="checkbox" checked={value.auto} onChange={(e) => set({ auto: e.target.checked })} className="mt-0.5 size-4 accent-violet-500" />
        <span>
          Correção automática
          <span className="block text-xs text-muted">
            {!value.correction
              ? "Analisando a imagem do vídeo…"
              : notes.length
                ? `${notes.join(", ")}.`
                : "A imagem já estava equilibrada: mexemos pouco."}
          </span>
        </span>
      </label>
      <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1" role="group" aria-label="Filtro">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            aria-pressed={value.filter === f.id}
            onClick={() => set({ filter: f.id, amount: value.filter === f.id ? value.amount : f.id === "natural" ? 100 : 70 })}
            className={cn(
              "flex shrink-0 flex-col items-center rounded-xl border px-3 py-2 text-xs transition",
              value.filter === f.id ? "border-violet-400 bg-primary/15" : "border-border hover:bg-white/5",
            )}
          >
            <span className="font-semibold">{f.label}</span>
            <span className="text-[10px] text-muted">{f.hint}</span>
          </button>
        ))}
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        {value.filter !== "natural" && <LookSlider label="Força do filtro" value={value.amount} onChange={(amount) => set({ amount })} />}
        <LookSlider label="Nitidez" value={value.sharpen} onChange={(sharpen) => set({ sharpen })} />
        <LookSlider label="Vinheta" value={value.vignette} onChange={(vignette) => set({ vignette })} />
      </div>
      <p className="text-[11px] text-subtle">No player aparece a cor e a vinheta; a nitidez aparece na prévia do quadro abaixo e no vídeo final.</p>
    </section>
  );
}
