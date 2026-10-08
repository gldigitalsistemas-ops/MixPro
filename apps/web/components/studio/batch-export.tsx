"use client";

import { openPicker } from "@/lib/media/file-access";
import { reportError } from "@/lib/error-log";
import { DELIVERY_TARGETS, type DeliveryId } from "@mixpro/contracts";
import { useRef, useState } from "react";
import { CheckCircle2, Download, Files, Loader2, Share2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ProgressBar } from "@/components/ui/misc";
import { useToast } from "@/components/ui/toast";
import { NeedLoginError, NoCreditsError } from "@/lib/account";
import type { ChainDoc } from "@/lib/dsp/chain";
import type { DrumSampleSet } from "@/lib/dsp/drums/studio";
import { runDsp } from "@/lib/dsp/runner";
import type { DrumKit } from "@/lib/drums/library";
import { ensureCaptionFont } from "@/lib/captions/font";
import { ctaSeconds, needsRender, type Look } from "@/lib/media/compose";
import { speechSegments } from "@/lib/media/cuts";
import { MediaError, exportAudio, exportVideo } from "@/lib/media/export";
import { loadMedia, MediaLoadError } from "@/lib/media/load";
import { analyzeVideoColor } from "@/lib/media/frames";
import { renderVideo } from "@/lib/media/render";
import { track } from "@/lib/track";

type Item = {
  name: string;
  state: "waiting" | "working" | "done" | "error";
  progress: number;
  label?: string;
  result?: { url: string; blob: Blob; filename: string };
  error?: string;
};

const ACCEPT = "video/*,audio/*,.mp4,.mov,.m4a,.mp3,.wav,.aac,.flac,.ogg,.webm";
const MAX_FILES = 10;

function fnv(text: string): string {
  let h = 0x811c9dc5;
  for (const ch of text) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

/** Aplica o mesmo som (e formato/selo) em vários vídeos ou áudios, um de cada vez. */
export function BatchExport(props: {
  presetSlug: string;
  chain: ChainDoc;
  intensity: number;
  denoise: number;
  social: boolean;
  delivery: DeliveryId;
  look: Look;
  assetsAt: (sampleRate: number) => Promise<{ drumSamples?: DrumSampleSet; impulses?: Record<string, Float32Array> }>;
  lockedKits: DrumKit[];
  onUnlock: (kits: DrumKit[]) => Promise<boolean>;
  spend: (ref: string, kind: "video" | "audio") => Promise<void>;
  balance: number | null;
  signedIn: boolean;
  requireLogin: (reason: string) => Promise<boolean>;
  onNeedCredits: () => void;
}) {
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [running, setRunning] = useState(false);
  // sem legendas no lote (cada vídeo tem a sua fala); formato, enquadramento e selo valem para todos
  const look: Look = { ...props.look, captions: null, beforeAfter: null };

  const patch = (i: number, p: Partial<Item>) => setItems((list) => list.map((x, j) => (j === i ? { ...x, ...p } : x)));

  async function start(files: File[]) {
    if (!files.length) return;
    if (files.length > MAX_FILES) {
      toast.error(`Escolha até ${MAX_FILES} arquivos por vez.`);
      files = files.slice(0, MAX_FILES);
    }
    if (!props.signedIn && !(await props.requireLogin("Entre na sua conta para aplicar o som em vários vídeos."))) return;
    if (props.balance !== null && props.balance < files.length) {
      toast.error(`São ${files.length} arquivos e você tem ${props.balance} ${props.balance === 1 ? "crédito" : "créditos"}. Cada arquivo usa 1 crédito.`);
      return props.onNeedCredits();
    }
    if (props.lockedKits.length && !(await props.onUnlock(props.lockedKits))) return;

    items.forEach((x) => x.result && URL.revokeObjectURL(x.result.url));
    setItems(files.map((f) => ({ name: f.name, state: "waiting", progress: 0 })));
    setRunning(true);
    let done = 0;
    for (const [i, file] of files.entries()) {
      try {
        patch(i, { state: "working", label: "Lendo o arquivo…", progress: 0 });
        const media = await loadMedia(file, (p) => patch(i, { progress: p * 20 }));
        const assets = await props.assetsAt(media.sampleRate);
        patch(i, { label: "Aplicando o som…" });
        const processed = await runDsp(
          { channels: media.channels, sampleRate: media.sampleRate, chain: props.chain, intensity: props.intensity, social: props.social, delivery: { targetLufs: DELIVERY_TARGETS[props.delivery].targetLufs, ceilingDb: DELIVERY_TARGETS[props.delivery].ceilingDb }, denoise: props.denoise, ...assets },
          (p) => patch(i, { progress: 20 + p * 50 }),
        );
        const onProgress = (p: number) => patch(i, { progress: 70 + p * 30 });
        let out;
        if (media.kind === "video") {
          patch(i, { label: "Montando o vídeo…" });
          // cada vídeo tem a sua luz: a correção automática de cor é medida em cada um
          const color = look.color?.auto ? { ...look.color, correction: await analyzeVideoColor(file, media.duration).catch(() => null) } : look.color;
          // a chamada final vale para os últimos segundos de cada vídeo
          const cta = look.cta
            ? { ...look.cta, start: media.audioStart + media.duration - ctaSeconds(media.duration), end: media.audioStart + media.duration }
            : null;
          const fileLook: Look = { ...look, color, cta };
          if (needsRender(fileLook, false)) {
            await ensureCaptionFont();
            const segments = speechSegments(media.channels, media.sampleRate, media.audioStart, "off", null);
            out = await renderVideo({ media, audio: processed.channels, segments, look: fileLook, audiogram: null, onProgress });
          } else out = await exportVideo(media, processed.channels, onProgress);
        } else {
          patch(i, { label: "Gerando o MP3…" });
          out = await exportAudio(media, processed.channels, "mp3", onProgress);
        }
        const key = fnv(`${file.name}|${file.size}|${file.lastModified}|${JSON.stringify(props.chain)}|${props.intensity}|${props.denoise}|${look.format}|${look.watermark}|${JSON.stringify(look.color ? [look.color.auto, look.color.filter, look.color.amount, look.color.sharpen, look.color.vignette] : 0)}|${look.cta?.text ?? ""}|${look.cta?.handle ?? ""}`);
        await props.spend(`lote_${props.presetSlug.slice(0, 40)}_${key}`, media.kind === "video" ? "video" : "audio");
        patch(i, { state: "done", progress: 100, result: { url: URL.createObjectURL(out.blob), blob: out.blob, filename: out.filename } });
        done++;
      } catch (err) {
        if (err instanceof NoCreditsError) {
          patch(i, { state: "error", error: "Créditos acabaram" });
          props.onNeedCredits();
          break;
        }
        if (err instanceof NeedLoginError) {
          patch(i, { state: "error", error: "Entre na sua conta" });
          break;
        }
        const known = err instanceof MediaLoadError || err instanceof MediaError;
        reportError("lote", err, { severity: known ? "aviso" : "erro", context: { tamanho_mb: Math.round(file.size / 1e6), tipo: file.type } });
        patch(i, {
          state: "error",
          error: known ? (err as Error).message : "Não foi possível processar este arquivo.",
        });
      }
    }
    setRunning(false);
    track("batch_export", { files: files.length, done });
    if (done) toast.success(`${done} ${done === 1 ? "arquivo pronto" : "arquivos prontos"}.`);
  }

  async function share(item: Item) {
    if (!item.result) return;
    const file = new File([item.result.blob], item.result.filename, { type: item.result.blob.type });
    try {
      await navigator.share({ files: [file], title: "Mix Pro" });
    } catch (e) {
      if ((e as Error).name !== "AbortError") download(item);
    }
  }

  function download(item: Item) {
    if (!item.result) return;
    const a = document.createElement("a");
    a.href = item.result.url;
    a.download = item.result.filename;
    a.click();
  }

  const ready = items.filter((x) => x.result);
  const canShare = (x: Item) =>
    Boolean(x.result && navigator.canShare?.({ files: [new File([x.result.blob], x.result.filename, { type: x.result.blob.type })] }));

  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-border p-3">
      <input
        ref={input}
        type="file"
        multiple
        accept={ACCEPT}
        className="hidden"
        onChange={(e) => {
          // o campo só é limpo ao abrir o seletor: limpar aqui fazia o iPhone apagar a cópia
          // temporária do vídeo da Galeria antes da leitura ("NotFoundError")
          void start([...(e.target.files ?? [])]);
        }}
      />
      <div className="flex items-start gap-3">
        <Files className="mt-0.5 size-5 shrink-0 text-violet-300" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">Aplicar em vários vídeos</p>
          <p className="text-xs text-muted">
            Mesmo som{look.format !== "original" ? `, formato ${look.format}` : ""}
            {look.watermark ? " e selo" : ""} em até {MAX_FILES} arquivos de uma vez (sem legendas e cortes, que são de cada vídeo). 1 crédito por
            arquivo.
          </p>
        </div>
      </div>
      <Button variant="secondary" onClick={() => openPicker(input.current)} disabled={running}>
        <Files className="size-4" /> {running ? "Processando…" : "Escolher os arquivos"}
      </Button>

      {items.length > 0 && (
        <ul className="flex flex-col gap-2">
          {items.map((x, i) => (
            <li key={`${x.name}-${i}`} className="flex flex-col gap-1.5 rounded-xl bg-white/5 p-2.5">
              <div className="flex items-center gap-2 text-sm">
                {x.state === "done" ? (
                  <CheckCircle2 className="size-4 shrink-0 text-green-400" />
                ) : x.state === "error" ? (
                  <XCircle className="size-4 shrink-0 text-red-400" />
                ) : x.state === "working" ? (
                  <Loader2 className="size-4 shrink-0 animate-spin text-violet-300" />
                ) : (
                  <span className="size-4 shrink-0 rounded-full border border-border-strong" />
                )}
                <span className="min-w-0 flex-1 truncate">{x.name}</span>
                {x.result && (
                  <>
                    {canShare(x) && (
                      <button onClick={() => share(x)} aria-label={`Postar ${x.name}`} className="rounded-full p-1.5 text-muted hover:bg-white/10 hover:text-text">
                        <Share2 className="size-4" />
                      </button>
                    )}
                    <button onClick={() => download(x)} aria-label={`Baixar ${x.name}`} className="rounded-full p-1.5 text-muted hover:bg-white/10 hover:text-text">
                      <Download className="size-4" />
                    </button>
                  </>
                )}
              </div>
              {x.state === "working" && <ProgressBar value={x.progress} label={x.label ?? x.name} />}
              {x.state === "working" && x.label && <p className="text-[11px] text-subtle">{x.label}</p>}
              {x.error && <p className="text-[11px] text-red-300">{x.error}</p>}
            </li>
          ))}
        </ul>
      )}
      {ready.length > 1 && !running && (
        <Button variant="ghost" size="sm" onClick={() => ready.forEach((x, k) => setTimeout(() => download(x), k * 400))}>
          <Download className="size-4" /> Baixar todos ({ready.length})
        </Button>
      )}
    </div>
  );
}
