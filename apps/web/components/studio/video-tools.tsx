"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ImageDown, ImagePlus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
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

export type VideoToolsState = {
  cut: CutLevel;
  format: VideoFormat;
  fit: Fit;
  watermark: boolean;
  audiogram: AudiogramStyle | null;
};

export const defaultVideoTools = (media: LoadedMedia): VideoToolsState => ({
  cut: "off",
  format: media.kind === "video" ? "original" : "9:16",
  fit: "blur",
  watermark: true,
  audiogram: null,
});

const FORMATS: { value: VideoFormat; label: string; hint: string }[] = [
  { value: "original", label: "Original", hint: "Como foi gravado" },
  { value: "9:16", label: "9:16", hint: "Reels, TikTok, Shorts" },
  { value: "1:1", label: "1:1", hint: "Feed quadrado" },
  { value: "4:5", label: "4:5", hint: "Feed do Instagram" },
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
}: {
  media: LoadedMedia;
  videoUrl: string | null;
  value: VideoToolsState;
  onChange: (v: VideoToolsState) => void;
  segments: Segment[];
  hasWords: boolean;
  look: Look;
}) {
  const toast = useToast();
  const set = (patch: Partial<VideoToolsState>) => onChange({ ...value, ...patch });
  const isVideo = media.kind === "video";
  const kept = keptDuration(segments);
  const [time, setTime] = useState(Math.min(1, media.duration / 2));
  const [coverTitle, setCoverTitle] = useState("");
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

  async function downloadCover() {
    await ensureCaptionFont();
    const v = video.current;
    const src = isVideo && v && v.videoWidth ? { w: v.videoWidth, h: v.videoHeight } : null;
    const size = src ? outputSize(src.w, src.h, value.format) : outputSize(1080, 1920, value.format === "original" ? "9:16" : value.format);
    const c = document.createElement("canvas");
    c.width = size.width;
    c.height = size.height;
    const ctx = c.getContext("2d")!;
    const coverLook: Look = { ...look, captions: null };
    if (src && v) composeFrame(ctx, c.width, c.height, v, src.w, src.h, time, coverLook);
    else if (env && value.audiogram) composeAudiogram(ctx, c.width, c.height, Math.floor(time * 30), env, time, value.audiogram, coverLook);
    if (coverTitle.trim()) drawCoverTitle(ctx, c.width, c.height, coverTitle.trim(), look.fontFamily);
    c.toBlob((blob) => {
      if (!blob) return toast.error("Não foi possível gerar a capa.");
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `${media.file.name.replace(/\.[^.]+$/, "")}-capa.jpg`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    }, "image/jpeg", 0.92);
  }

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
        <h3 className="text-sm font-medium">Prévia do quadro e capa</h3>
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
        <div className="flex gap-2">
          <input
            value={coverTitle}
            onChange={(e) => setCoverTitle(e.target.value.slice(0, 60))}
            placeholder="Título da capa (opcional)"
            className="h-10 min-w-0 flex-1 rounded-xl border border-border-strong bg-black/20 px-3 text-sm outline-none focus:border-violet-400"
          />
          <Button variant="secondary" onClick={() => void downloadCover()}>
            <ImageDown className="size-4" /> Capa
          </Button>
        </div>
        <p className="text-xs text-subtle">A capa é grátis: use como thumbnail no YouTube, Reels ou TikTok.</p>
      </section>
      </>
      )}
    </div>
  );
}

/** Título grande da capa, no estilo das legendas (branco com contorno e a última palavra em amarelo). */
function drawCoverTitle(ctx: CanvasRenderingContext2D, W: number, H: number, title: string, fontFamily: string) {
  const size = Math.round(Math.min(W, H) * 0.11);
  ctx.save();
  ctx.font = `900 ${size}px ${fontFamily}`;
  ctx.textBaseline = "middle";
  ctx.lineJoin = "round";
  const words = title.toLocaleUpperCase("pt-BR").split(/\s+/);
  const lines: string[][] = [[]];
  for (const w of words) {
    const cur = lines[lines.length - 1];
    if (cur.length && ctx.measureText([...cur, w].join(" ")).width > W * 0.86) lines.push([w]);
    else cur.push(w);
  }
  const lineH = size * 1.1;
  const top = H * 0.2 - ((lines.length - 1) * lineH) / 2;
  const last = words.length - 1;
  let idx = 0;
  lines.forEach((line, li) => {
    const text = line.join(" ");
    let x = (W - ctx.measureText(text).width) / 2;
    const y = top + li * lineH;
    for (const w of line) {
      ctx.lineWidth = size * 0.2;
      ctx.strokeStyle = "#000";
      ctx.strokeText(w, x, y);
      ctx.fillStyle = idx === last ? "#ffe500" : "#fff";
      ctx.fillText(w, x, y);
      x += ctx.measureText(w + " ").width;
      idx++;
    }
  });
  ctx.restore();
}
