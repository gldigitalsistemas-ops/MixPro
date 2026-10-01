"use client";

import { useEffect, useRef, useState } from "react";
import { AudioLines, Copy, Download, Film, Music, Share2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ProgressBar } from "@/components/ui/misc";
import { useToast } from "@/components/ui/toast";
import { NeedLoginError, NoCreditsError } from "@/lib/account";
import { ensureCaptionFont } from "@/lib/captions/font";
import type { Word } from "@/lib/captions/model";
import { track } from "@/lib/track";
import { runDsp, type DspResult } from "@/lib/dsp/runner";
import { needsRender, type AudiogramStyle, type Look } from "@/lib/media/compose";
import { keptDuration, spliceAudio, type Segment } from "@/lib/media/cuts";
import { MediaError, exportAudio, exportVideo, type AudioFormat } from "@/lib/media/export";
import type { LoadedMedia } from "@/lib/media/load";
import { renderVideo } from "@/lib/media/render";
import { mixMusic, safeCeiling } from "@/lib/media/music";
import type { MusicState } from "./music-picker";
import type { Signal } from "@/lib/dsp/types";
import type { StudioPreset } from "@/lib/presets";
import type { ChainDoc } from "@/lib/dsp/chain";
import type { DrumSampleSet } from "@/lib/dsp/drums/studio";
import type { DrumKit } from "@/lib/drums/library";
import { beforeAfterAudio } from "@/lib/media/before-after";
import { FILTERS, lookIsActive, lookMatrix } from "@/lib/media/color";
import { BatchExport } from "./batch-export";
import { keepAwake } from "@/lib/wake-lock";
import { isPhone } from "@/lib/device";
import { cn, formatDuration } from "@/lib/cn";

export type Target = "video" | AudioFormat;
type Phase = { label: string; progress: number } | null;
type Result = { url: string; blob: Blob; filename: string; target: Target; key: string };

type Props = {
  media: LoadedMedia;
  preset: StudioPreset | null;
  /** Cadeia efetiva (preset + ajustes finos, ex.: bateria); null enquanto os samples carregam. */
  chain: ChainDoc | null;
  drumSamples?: DrumSampleSet;
  impulses?: Record<string, Float32Array>;
  /** Kits premium usados que ainda precisam ser desbloqueados para baixar. */
  lockedKits: DrumKit[];
  onUnlock: (kits: DrumKit[]) => Promise<boolean>;
  /** Samples e IRs na taxa de outro arquivo (para aplicar em vários vídeos). */
  assetsAt: (sampleRate: number) => Promise<{ drumSamples?: DrumSampleSet; impulses?: Record<string, Float32Array> }>;
  intensity: number;
  denoise: number;
  social: boolean;
  onSocialChange: (v: boolean) => void;
  /** Trechos mantidos (tempo do original) e se há cortes de pausas. */
  segments: Segment[];
  cutting: boolean;
  look: Look;
  /** Estilo do audiograma quando o arquivo é só áudio (null = não gerar vídeo). */
  audiogram: AudiogramStyle | null;
  music: MusicState | null;
  /** Fala transcrita (legendas), para sugerir o texto do post. */
  words: Word[] | null;
  /** Descrição do post (montada no cartão "Descrição do post"). */
  postText: string;
  balance: number | null;
  /** Debita 1 crédito (lança NoCreditsError quando não há saldo). */
  spend: (ref: string, kind: "video" | "audio") => Promise<void>;
  onNeedCredits: () => void;
  signedIn: boolean;
  /** Abre o login/cadastro; resolve true quando a pessoa entrou. */
  requireLogin: (reason: string) => Promise<boolean>;
};

function fnv(text: string): string {
  let h = 0x811c9dc5;
  for (const ch of text) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

const fileKey = (f: File) => fnv(`${f.name}|${f.size}|${f.lastModified}`);
const canShareFiles = (file: File) => typeof navigator !== "undefined" && !!navigator.canShare?.({ files: [file] });

/**
 * Baixa a partir do arquivo em memória, com um link novo a cada clique (um link antigo pode ter
 * sido liberado pelo navegador depois de muita memória em uso, e aí o download sai vazio).
 */
function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  triggerDownload(url, filename);
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

function triggerDownload(url: string, filename: string) {
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export function ExportPanel(props: Props) {
  const { media, preset, chain, intensity, denoise, social, onSocialChange, segments, cutting, look, audiogram, music } = props;
  const { balance, spend, onNeedCredits, signedIn, requireLogin, drumSamples, impulses, lockedKits, onUnlock } = props;
  const toast = useToast();
  const [phase, setPhase] = useState<Phase>(null);
  // vídeo "antes → depois" (só para vídeo)
  const [beforeAfter, setBeforeAfter] = useState(false);
  const comparing = beforeAfter && media.kind === "video";
  const [lastResult, setResult] = useState<Result | null>(null);
  const cache = useRef<{ key: string; value: DspResult } | null>(null);
  const running = useRef(false);

  // o áudio tratado (cache) só depende do som; o arquivo final depende também de cortes, formato e legendas
  const audioKey = preset && chain
    ? `${fileKey(media.file)}_${preset.slug}_${intensity}_${social ? 1 : 0}_n${Math.round(denoise * 100)}_x${fnv(JSON.stringify(chain))}`
    : null;
  const editKey = fnv(
    JSON.stringify([
      cutting ? segments.map((s) => [s.start.toFixed(2), s.end.toFixed(2)]) : 0,
      look.format,
      look.fit,
      look.watermark,
      look.captions ? [look.captions.captions, look.captions.style, look.captions.position] : 0,
      audiogram ? [audiogram.palette, audiogram.title, Boolean(audiogram.image)] : 0,
      music ? [music.name, music.level] : 0,
      comparing ? "antes-depois" : 0,
      look.cta ? [look.cta.text, look.cta.handle] : 0,
      lookIsActive(look.color) ? [lookMatrix(look.color!).map((v) => v.toFixed(3)), look.color!.sharpen, look.color!.vignette] : 0,
    ]),
  );
  const settingsKey = audioKey && `${audioKey}_e${editKey}`;

  useEffect(() => () => {
    if (lastResult) URL.revokeObjectURL(lastResult.url);
  }, [lastResult]);
  const result = lastResult?.key === settingsKey ? lastResult : null;

  async function processFull(): Promise<DspResult> {
    if (cache.current?.key === audioKey) return cache.current.value;
    const value = await runDsp(
      { channels: media.channels, sampleRate: media.sampleRate, chain: chain!, intensity, social, denoise, drumSamples, impulses },
      (p) =>
        setPhase({
          label: denoise > 0 && p < 0.5 ? "Removendo o ruído de fundo…" : "Aplicando o som no arquivo inteiro…",
          progress: p * 100,
        }),
    );
    cache.current = { key: audioKey!, value };
    return value;
  }

  const makesVideo = media.kind === "video" || audiogram !== null;
  const withMusic = (a: Signal) =>
    music ? safeCeiling(mixMusic(a, music.channels, media.sampleRate, music.level, 0, a[0].length), media.sampleRate) : a;

  async function run(target: Target) {
    // trava contra toque duplo (o estado "phase" só muda depois do login/desbloqueio)
    if (!preset || !settingsKey || phase || running.current) return;
    running.current = true;
    let release = () => {};
    try {
      if (!signedIn && !(await requireLogin("Crie sua conta grátis para baixar — os primeiros downloads são por nossa conta."))) return;
      if (signedIn && balance !== null && balance <= 0) return onNeedCredits();
      // kit premium: desbloqueia uma vez (ouvir e testar continuam livres)
      if (lockedKits.length && !(await onUnlock(lockedKits))) return;
      release = await keepAwake();
      await generate(target);
    } finally {
      release();
      running.current = false;
    }
  }

  async function generate(target: Target) {
    if (!preset || !settingsKey) return;
    try {
      setPhase({ label: "Aplicando o som no arquivo inteiro…", progress: 0 });
      const processed = await processFull();
      let out;
      if (target === "video") {
        const compare = comparing && target === "video";
        const render = media.kind === "audio" || compare || needsRender(look, cutting);
        const label = media.kind === "audio" ? "Criando o audiograma…" : render ? "Montando o vídeo quadro a quadro…" : "Montando o vídeo com o som novo…";
        setPhase({ label, progress: 0 });
        const onProgress = (p: number) => setPhase({ label, progress: p * 100 });
        if (render) {
          await ensureCaptionFont();
          let audio = processed.channels;
          let finalLook = look;
          if (compare) {
            const ba = beforeAfterAudio(media.channels, processed.channels, media.sampleRate, media.audioStart, segments);
            audio = ba.audio;
            finalLook = { ...look, beforeAfter: { split: ba.split } };
          }
          out = await renderVideo({ media, audio, segments, look: finalLook, audiogram, postAudio: withMusic, onProgress });
        } else {
          out = await exportVideo(media, withMusic(processed.channels), onProgress);
        }
      } else {
        const label = "Gerando o arquivo de áudio…";
        setPhase({ label, progress: 0 });
        const audio = withMusic(
          cutting ? spliceAudio(processed.channels, media.sampleRate, media.audioStart, segments) : processed.channels,
        );
        out = await exportAudio(media, audio, target, (p) => setPhase({ label, progress: p * 100 }));
      }

      await spend(`${settingsKey}_${target}`, target === "video" ? "video" : "audio");
      // no celular, libera o áudio tratado da memória (gerar de novo é rápido; ficar com ele pode derrubar a página)
      if (isPhone()) cache.current = null;
      track("export", { target, preset: preset.slug, captions: Boolean(look.captions), music: Boolean(music), before_after: comparing });

      const url = URL.createObjectURL(out.blob);
      setResult({ url, blob: out.blob, filename: out.filename, target, key: settingsKey });
      if (!canShareFiles(new File([out.blob], out.filename, { type: out.blob.type }))) downloadBlob(out.blob, out.filename);
    } catch (err) {
      if (err instanceof NoCreditsError) onNeedCredits();
      else if (err instanceof NeedLoginError) void requireLogin("Entre na sua conta para baixar.");
      else if (err instanceof MediaError) toast.error(err.message);
      else {
        console.error("[export]", err);
        toast.error("Não foi possível gerar o arquivo neste aparelho. Tente de novo ou baixe só o áudio.");
      }
    } finally {
      setPhase(null);
    }
  }

  async function copyPost(silent = false) {
    try {
      await navigator.clipboard.writeText(post);
      if (!silent) toast.success("Legenda copiada. É só colar no post.");
      return true;
    } catch {
      if (!silent) toast.error("Não foi possível copiar. Selecione o texto e copie.");
      return false;
    }
  }

  async function shareResult() {
    if (!result) return;
    const file = new File([result.blob], result.filename, { type: result.blob.type });
    // Instagram e TikTok ignoram o texto do compartilhamento: vai também para a área de transferência
    // (sem await antes do share: o Safari exige que o share saia direto do toque)
    const copied = copyPost(true);
    try {
      await navigator.share({ files: [file], title: "Mix Pro", text: post });
      track("share", { target: result.target });
      if (await copied) toast.success("A legenda do post está copiada: cole na descrição.");
    } catch (e) {
      if ((e as Error).name !== "AbortError") downloadBlob(result.blob, result.filename);
    }
  }

  const busy = phase !== null;
  const post = props.postText;
  const shareable = result ? canShareFiles(new File([result.blob], result.filename, { type: result.blob.type })) : false;
  const saved = cutting ? media.duration - keptDuration(segments) : 0;
  const summary = [
    preset?.name,
    denoise > 0 && (denoise >= 1 ? "ruído removido" : "ruído reduzido"),
    look.captions && "legendas",
    makesVideo && look.cta && "chamada no final",
    makesVideo && look.format !== "original" && `formato ${look.format}`,
    cutting && saved >= 0.5 && `${formatDuration(saved)} de pausas cortadas`,
    music && "música de fundo",
    makesVideo && look.watermark && !comparing && "selo Mix Pro",
    comparing && "antes → depois",
    media.kind === "video" && lookIsActive(look.color) && (look.color!.filter === "natural" ? "imagem corrigida" : `imagem: ${FILTERS.find((f) => f.id === look.color!.filter)?.label}`),
    lockedKits.length > 0 && `kit premium: ${lockedKits.map((k) => k.name).join(", ")}`,
  ].filter(Boolean) as string[];

  return (
    <div className="flex flex-col gap-4">
      {summary.length > 0 && (
        <ul className="flex flex-wrap gap-1.5" aria-label="O que será aplicado">
          {summary.map((s) => (
            <li key={s} className="rounded-full bg-primary/15 px-2.5 py-1 text-xs text-violet-200">
              {s}
            </li>
          ))}
        </ul>
      )}

      <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-border p-3">
        <input type="checkbox" checked={social} onChange={(e) => onSocialChange(e.target.checked)} className="mt-1 size-4 accent-violet-500" />
        <span>
          <span className="block text-sm font-medium">Volume ideal para redes sociais</span>
          <span className="block text-xs text-muted">
            Ajusta para -14 LUFS, o padrão de Instagram, TikTok e YouTube. Seu vídeo não fica mais baixo que os outros.
          </span>
        </span>
      </label>

      {media.kind === "video" && (
        <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-violet-400/30 bg-primary/5 p-3">
          <input type="checkbox" checked={beforeAfter} onChange={(e) => setBeforeAfter(e.target.checked)} className="mt-1 size-4 accent-violet-500" />
          <span>
            <span className="block text-sm font-medium">Vídeo “antes → depois” para Reels</span>
            <span className="block text-xs text-muted">
              O começo toca o som original do celular com o selo ANTES; na virada entra o som de estúdio com o selo DEPOIS. O formato
              que mais chama atenção — e mostra o seu trabalho.
            </span>
          </span>
        </label>
      )}

      {lockedKits.length > 0 && (
        <p className="rounded-2xl border border-amber-400/30 bg-amber-400/5 p-3 text-xs text-amber-100">
          Você está usando o kit premium {lockedKits.map((k) => `“${k.name}” (${k.price_credits} créditos)`).join(" e ")}. Ouvir é
          grátis; ao baixar, você desbloqueia o kit para sempre.
        </p>
      )}

      {phase ? (
        <div className="flex flex-col gap-2 rounded-2xl bg-white/5 p-4" aria-live="polite">
          <p className="text-sm">{phase.label}</p>
          <ProgressBar value={phase.progress} label={phase.label} />
          <p className="text-xs text-subtle">Tudo acontece no seu aparelho. Mantenha esta tela aberta e não troque de app até terminar.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <Button size="lg" onClick={() => run(makesVideo ? "video" : "mp3")} disabled={!preset || !chain || busy} className="w-full">
            {media.kind === "video" ? <Film className="size-5" /> : audiogram ? <AudioLines className="size-5" /> : <Music className="size-5" />}
            {media.kind === "video" ? "Gerar vídeo pronto para postar" : audiogram ? "Gerar audiograma (vídeo)" : "Gerar áudio pronto (MP3)"}
          </Button>
          <div className="grid grid-cols-3 gap-2">
            {(makesVideo ? (["mp3", "wav", "m4a"] as const) : (["wav", "m4a"] as const)).map((f) => (
              <Button key={f} variant="secondary" size="sm" onClick={() => run(f)} disabled={!preset || !chain || busy}>
                <Download className="size-4" /> {f.toUpperCase()}
              </Button>
            ))}
          </div>
          <p className="text-center text-xs text-subtle">
            {signedIn
              ? `Usa 1 crédito${balance !== null ? ` · você tem ${balance}` : ""}. Baixar de novo o mesmo resultado não gasta crédito.`
              : "Para baixar, entre ou crie sua conta grátis. Ouvir e testar não precisa de conta."}
          </p>
        </div>
      )}

      {result && (
        <div className="flex flex-col gap-3 rounded-2xl border border-success/30 bg-success/5 p-4">
          <p className="flex items-center gap-2 text-sm font-medium text-green-300">
            <Sparkles className="size-4" /> Pronto! Seu {result.target === "video" ? "vídeo" : "áudio"} está com som de estúdio.
          </p>
          {result.target === "video" ? (
            <video src={result.url} controls playsInline className={cn("mx-auto max-h-[60dvh] w-full max-w-sm rounded-xl bg-black")} />
          ) : (
            <audio src={result.url} controls className="w-full" />
          )}
          <p className="text-xs text-muted">Ao postar, a descrição do post já vai copiada: é só colar.</p>
          <div className="grid gap-2 sm:grid-cols-3">
            {shareable && (
              <Button onClick={shareResult}>
                <Share2 className="size-4" /> Postar
              </Button>
            )}
            <Button variant="secondary" onClick={() => copyPost()}>
              <Copy className="size-4" /> Copiar descrição
            </Button>
            <Button variant={shareable ? "secondary" : "primary"} onClick={() => downloadBlob(result.blob, result.filename)}>
              <Download className="size-4" /> Baixar arquivo
            </Button>
          </div>
        </div>
      )}

      {!busy && preset && chain && (
        <BatchExport
          presetSlug={preset.slug}
          chain={chain}
          intensity={intensity}
          denoise={denoise}
          social={social}
          look={look}
          assetsAt={props.assetsAt}
          lockedKits={lockedKits}
          onUnlock={onUnlock}
          spend={spend}
          balance={balance}
          signedIn={signedIn}
          requireLogin={requireLogin}
          onNeedCredits={onNeedCredits}
        />
      )}
    </div>
  );
}
