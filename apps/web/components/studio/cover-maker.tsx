"use client";

import { readableFile } from "@/lib/media/file-access";
import { reportError } from "@/lib/error-log";
import { useEffect, useRef, useState } from "react";
import { ImageDown, Loader2, Share2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/misc";
import { useToast } from "@/components/ui/toast";
import { ensureCaptionFont } from "@/lib/captions/font";
import { composeFrame, outputSize, type Look, type VideoFormat } from "@/lib/media/compose";
import { bestCoverFrames, sampleFrames, type SampledFrame } from "@/lib/media/frames";
import type { LoadedMedia } from "@/lib/media/load";
import { cn, formatDuration } from "@/lib/cn";

type TitleStyle = "impacto" | "caixa" | "limpo";
type TitlePos = "top" | "middle" | "bottom";

const FORMATS: { value: VideoFormat; label: string }[] = [
  { value: "9:16", label: "Reels / TikTok" },
  { value: "16:9", label: "YouTube" },
  { value: "1:1", label: "Quadrada" },
];
const STYLES: { value: TitleStyle; label: string }[] = [
  { value: "impacto", label: "Impacto" },
  { value: "caixa", label: "Caixa" },
  { value: "limpo", label: "Limpo" },
];
const POSITIONS: { value: TitlePos; label: string }[] = [
  { value: "top", label: "Em cima" },
  { value: "middle", label: "Meio" },
  { value: "bottom", label: "Embaixo" },
];

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/** Título da capa: grande, legível no celular, com a palavra-chave (a última) destacada. */
function drawTitle(ctx: Ctx, W: number, H: number, title: string, style: TitleStyle, pos: TitlePos, fontFamily: string) {
  const text = title.trim();
  if (!text) return;
  const size = Math.round(Math.min(W, H) * (W > H ? 0.12 : 0.1));
  ctx.save();
  ctx.font = `900 ${size}px ${fontFamily}`;
  ctx.textBaseline = "middle";
  ctx.lineJoin = "round";
  const words = (style === "limpo" ? text : text.toLocaleUpperCase("pt-BR")).split(/\s+/);
  const maxW = W * (W > H ? 0.6 : 0.86);
  const lines: string[][] = [[]];
  for (const w of words) {
    const cur = lines[lines.length - 1];
    if (cur.length && ctx.measureText([...cur, w].join(" ")).width > maxW) lines.push([w]);
    else cur.push(w);
  }
  const lineH = size * 1.15;
  const blockH = lines.length * lineH;
  const cy = pos === "top" ? H * 0.08 + blockH / 2 : pos === "bottom" ? H * 0.9 - blockH / 2 : H / 2;
  // no YouTube (horizontal) o título fica à esquerda, como nas miniaturas de sucesso
  const left = W > H ? W * 0.06 : null;
  const last = words.length - 1;
  let idx = 0;
  lines.forEach((line, li) => {
    const lineText = line.join(" ");
    const lw = ctx.measureText(lineText).width;
    let x = left ?? (W - lw) / 2;
    const y = cy - blockH / 2 + lineH / 2 + li * lineH;
    if (style === "caixa") {
      const pad = size * 0.25;
      ctx.fillStyle = "#7c3aed";
      ctx.beginPath();
      ctx.roundRect(x - pad, y - lineH / 2, lw + pad * 2, lineH, size * 0.18);
      ctx.fill();
    }
    for (const w of line) {
      if (style === "impacto") {
        ctx.lineWidth = size * 0.2;
        ctx.strokeStyle = "#000";
        ctx.strokeText(w, x, y);
      } else if (style === "limpo") {
        ctx.shadowColor = "rgba(0,0,0,0.7)";
        ctx.shadowBlur = size * 0.35;
      }
      ctx.fillStyle = style === "impacto" && idx === last ? "#ffe500" : "#ffffff";
      ctx.fillText(w, x, y);
      ctx.shadowBlur = 0;
      x += ctx.measureText(`${w} `).width;
      idx++;
    }
  });
  ctx.restore();
}

function toDataUrl(c: HTMLCanvasElement | OffscreenCanvas): Promise<string> {
  if ("toDataURL" in c) return Promise.resolve(c.toDataURL("image/jpeg", 0.8));
  return c.convertToBlob({ type: "image/jpeg", quality: 0.8 }).then(
    (b) =>
      new Promise((res) => {
        const r = new FileReader();
        r.onload = () => res(String(r.result));
        r.readAsDataURL(b);
      }),
  );
}

/** Capa pronta: melhores momentos do vídeo, título grande e o mesmo tratamento de imagem. */
export function CoverMaker({ media, look, suggestion }: { media: LoadedMedia; look: Look; suggestion: string }) {
  const toast = useToast();
  const [frames, setFrames] = useState<(SampledFrame & { url: string })[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [time, setTime] = useState<number | null>(null);
  const [title, setTitle] = useState<string | null>(null);
  const [style, setStyle] = useState<TitleStyle>("impacto");
  const [pos, setPos] = useState<TitlePos>("top");
  const [format, setFormat] = useState<VideoFormat>(look.format === "16:9" ? "16:9" : "9:16");
  const [busy, setBusy] = useState(false);
  const preview = useRef<HTMLCanvasElement>(null);
  const shownTitle = title ?? suggestion;

  async function findBest() {
    setLoading(true);
    try {
      const file = await readableFile(media.file);
      if (!file) throw new DOMException("arquivo apagado pelo sistema", "NotFoundError");
      const best = await bestCoverFrames(file, media.duration);
      const withUrls = await Promise.all(best.map(async (f) => ({ ...f, url: await toDataUrl(f.canvas) })));
      setFrames(withUrls);
      if (withUrls[0]) setTime(withUrls[0].t);
    } catch (err) {
      reportError("capa-quadros", err);
      toast.error("Não foi possível ler os quadros do vídeo.");
    } finally {
      setLoading(false);
    }
  }

  /** Desenha a capa no tamanho pedido (prévia pequena ou arquivo final). */
  async function render(maxSide: number): Promise<HTMLCanvasElement | null> {
    if (time === null) return null;
    await ensureCaptionFont();
    const srcW = Math.min(1080, maxSide * 1.2);
    const file = await readableFile(media.file);
    if (!file) throw new DOMException("arquivo apagado pelo sistema", "NotFoundError");
    const [frame] = await sampleFrames(file, [time], srcW);
    if (!frame) return null;
    const size = outputSize(frame.width, frame.height, format);
    const scale = Math.min(1, maxSide / Math.max(size.width, size.height));
    const c = document.createElement("canvas");
    c.width = Math.round(size.width * scale);
    c.height = Math.round(size.height * scale);
    const ctx = c.getContext("2d")!;
    // capa sem legendas, selo nem "antes/depois": só imagem tratada + título
    const coverLook: Look = { ...look, format, captions: null, watermark: false, beforeAfter: null, fit: "blur" };
    composeFrame(ctx, c.width, c.height, frame.canvas, frame.width, frame.height, time, coverLook);
    drawTitle(ctx, c.width, c.height, shownTitle, style, pos, look.fontFamily);
    return c;
  }

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const c = await render(420);
      const p = preview.current;
      if (!c || !p || cancelled) return;
      p.width = c.width;
      p.height = c.height;
      p.getContext("2d")!.drawImage(c, 0, 0);
    })();
    return () => {
      cancelled = true;
    };
  }, [time, shownTitle, style, pos, format, look.color]); // eslint-disable-line react-hooks/exhaustive-deps

  async function exportCover(share: boolean) {
    setBusy(true);
    try {
      const c = await render(1920);
      if (!c) return;
      const blob = await new Promise<Blob | null>((res) => c.toBlob(res, "image/jpeg", 0.92));
      if (!blob) throw new Error("capa");
      const name = `${media.file.name.replace(/\.[^.]+$/, "")}-capa.jpg`;
      const file = new File([blob], name, { type: "image/jpeg" });
      if (share && navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: shownTitle || "Capa" }).catch(() => {});
      } else {
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = name;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      }
    } catch (err) {
      reportError("capa", err);
      toast.error("Não foi possível gerar a capa.");
    } finally {
      setBusy(false);
    }
  }

  if (!frames && !loading) {
    return (
      <button type="button" onClick={findBest} className="flex w-full items-center gap-3 rounded-2xl border border-violet-400/30 bg-primary/10 p-4 text-left">
        <Sparkles className="size-6 shrink-0 text-violet-300" />
        <span>
          <span className="block text-sm font-semibold">Criar capa (thumbnail)</span>
          <span className="text-xs text-muted">O app acha os melhores momentos do vídeo; você escolhe e coloca o título. Grátis.</span>
        </span>
      </button>
    );
  }

  return (
    <section className="flex flex-col gap-3">
      <h3 className="text-sm font-medium">Capa</h3>
      {loading ? (
        <p className="flex items-center gap-2 text-xs text-muted">
          <Loader2 className="size-4 animate-spin" /> Procurando os quadros mais nítidos e bem iluminados…
        </p>
      ) : (
        <div className="grid grid-cols-4 gap-2" role="group" aria-label="Momentos sugeridos">
          {frames!.map((f) => (
            <button
              key={f.t}
              type="button"
              aria-pressed={time === f.t}
              onClick={() => setTime(f.t)}
              className={cn("overflow-hidden rounded-lg border-2", time === f.t ? "border-violet-400" : "border-transparent opacity-80")}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={f.url} alt={`Momento ${formatDuration(f.t)}`} className="aspect-[9/16] w-full object-cover" />
            </button>
          ))}
        </div>
      )}
      {time !== null && (
        <>
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
          <input
            value={shownTitle}
            onChange={(e) => setTitle(e.target.value.slice(0, 60))}
            placeholder="Título da capa"
            aria-label="Título da capa"
            className="h-10 rounded-xl border border-border-strong bg-black/20 px-3 text-sm outline-none focus:border-violet-400"
          />
          <div className="flex flex-wrap gap-2">
            {FORMATS.map((f) => (
              <Chip key={f.value} active={format === f.value} onClick={() => setFormat(f.value)}>
                {f.label}
              </Chip>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            {STYLES.map((s) => (
              <Chip key={s.value} active={style === s.value} onClick={() => setStyle(s.value)}>
                {s.label}
              </Chip>
            ))}
            <span className="mx-1 w-px bg-border" aria-hidden />
            {POSITIONS.map((p) => (
              <Chip key={p.value} active={pos === p.value} onClick={() => setPos(p.value)}>
                {p.label}
              </Chip>
            ))}
          </div>
          <div className="flex justify-center rounded-2xl bg-black/40 p-3">
            <canvas ref={preview} className="max-h-[420px] max-w-full rounded-lg" aria-label="Prévia da capa" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Button onClick={() => exportCover(true)} loading={busy}>
              <Share2 className="size-4" /> Salvar ou postar
            </Button>
            <Button variant="secondary" onClick={() => exportCover(false)} disabled={busy}>
              <ImageDown className="size-4" /> Baixar JPG
            </Button>
          </div>
          <p className="text-xs text-subtle">A capa é grátis. No Reels e no TikTok, escolha-a como capa ao postar; no YouTube, envie como miniatura.</p>
        </>
      )}
    </section>
  );
}
