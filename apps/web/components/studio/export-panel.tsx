"use client";

import { isFileGone } from "@/lib/media/file-access";
import { beginTask, reportError } from "@/lib/error-log";
import { DELIVERY_IDS, DELIVERY_TARGETS, type DeliveryId } from "@mixpro/contracts";
import { useEffect, useRef, useState } from "react";
import { AudioLines, Copy, Download, Film, Music, Share2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ProgressBar } from "@/components/ui/misc";
import { useToast } from "@/components/ui/toast";
import { NeedLoginError, NoCreditsError, OfflineError } from "@/lib/account";
import type { Word } from "@/lib/captions/model";
import { track } from "@/lib/track";
import type { DspResult } from "@/lib/dsp/runner";
import type { AudiogramStyle, Look } from "@/lib/media/compose";
import { keptDuration, type CutLevel, type Segment } from "@/lib/media/cuts";
import { MediaError, type AudioFormat } from "@/lib/media/export";
import type { LoadedMedia } from "@/lib/media/load";
import type { MusicState } from "./music-picker";
import type { StudioPreset } from "@/lib/presets";
import type { DrumSampleSet } from "@/lib/dsp/drums/studio";
import type { CabIR, DrumKit, DrumLibraryItem } from "@/lib/drums/library";
import { FILTERS, lookIsActive } from "@/lib/media/color";
import { buildExportJob, composeChain, type ChainParts } from "@/lib/export/build-job";
import { executeExportJob, FILE_GONE } from "@/lib/export/execute-job";
import { rendersVideo } from "@/lib/export/look";
import { runServerExport, serverEligible, ServerExportError } from "@/lib/export/server-client";
import { remuxVideoWithAudio } from "@/lib/media/remux";
import { readableFile } from "@/lib/media/file-access";
import { audioRef, editRef, resultRef, settingsRef } from "@/lib/export/refs";
import { downloadBlob } from "@/lib/download";
import { BatchExport } from "./batch-export";
import { keepAwake } from "@/lib/wake-lock";
import { isPhone } from "@/lib/device";
import { cn, formatDuration } from "@/lib/cn";

export type Target = "video" | AudioFormat;
type Phase = { label: string; progress: number; server?: boolean } | null;
type Result = { url: string; blob: Blob; filename: string; target: Target; key: string };

type Props = {
  media: LoadedMedia;
  preset: StudioPreset | null;
  /** Partes da cadeia (preset ou personalizada, bateria, reverb, master); null enquanto os samples carregam. */
  chainParts: ChainParts | null;
  /** A cadeia base é a personalizada (valores já congelados). */
  customizing: boolean;
  /** Samples e IRs enviados (o job referencia os arquivos usados). */
  library: { drums: DrumLibraryItem[]; irs: CabIR[] };
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
  delivery: DeliveryId;
  onDeliveryChange: (v: DeliveryId) => void;
  /** Trechos mantidos (tempo do original) e se há cortes de pausas. */
  cutLevel: CutLevel;
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
  /** O servidor de exportação está ligado para esta conta (a rota /api/export/config decide). */
  serverExport?: boolean;
  /** Abre o login/cadastro; resolve true quando a pessoa entrou. */
  requireLogin: (reason: string) => Promise<boolean>;
};

const canShareFiles = (file: File) => typeof navigator !== "undefined" && !!navigator.canShare?.({ files: [file] });

export function ExportPanel(props: Props) {
  const { media, preset, chainParts, intensity, denoise, social, onSocialChange, delivery, onDeliveryChange, segments, cutting, look, audiogram, music } = props;
  const { balance, spend, onNeedCredits, signedIn, requireLogin, drumSamples, impulses, lockedKits, onUnlock } = props;
  const toast = useToast();
  const [phase, setPhase] = useState<Phase>(null);
  // vídeo "antes → depois" (só para vídeo)
  const [beforeAfter, setBeforeAfter] = useState(false);
  const comparing = beforeAfter && media.kind === "video";
  const [lastResult, setResult] = useState<Result | null>(null);
  const cache = useRef<{ key: string; value: DspResult } | null>(null);
  const running = useRef(false);
  /** Cancela o job no servidor (só existe enquanto ele roda lá). */
  const serverAbort = useRef<AbortController | null>(null);
  /** Arquivo já gerado cujo download não pôde ser registrado (sem internet): não gera de novo. */
  const unpaid = useRef<{ key: string; out: { blob: Blob; filename: string } } | null>(null);

  // cadeia final: as mesmas funções da prévia do estúdio (lib/export/build-job)
  const chain = chainParts ? composeChain(chainParts) : null;
  // o áudio tratado (cache) só depende do som; o arquivo final depende também de cortes, formato e legendas
  const audioKey = preset && chain ? audioRef({ file: media.file, presetSlug: preset.slug, intensity, social, denoise, chain, delivery: DELIVERY_TARGETS[delivery] }) : null;
  const editKey = editRef({ cutting, segments, look, audiogram, music, comparing });
  const settingsKey = audioKey && settingsRef(audioKey, editKey);

  useEffect(() => () => {
    if (lastResult) URL.revokeObjectURL(lastResult.url);
  }, [lastResult]);
  const result = lastResult?.key === settingsKey ? lastResult : null;

  const makesVideo = media.kind === "video" || audiogram !== null;

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
      const endTask = beginTask("exportar", target === "video" ? "gerar o vídeo" : `gerar o áudio (${target})`, { formato: target, preset: preset.slug });
      try {
        await generate(target);
      } finally {
        endTask();
      }
    } finally {
      release();
      running.current = false;
    }
  }

  async function generate(target: Target) {
    if (!preset || !settingsKey || !chainParts) return;
    try {
      // o pedido de exportação como dado puro; o p_ref (idempotency_ref) é o mesmo de antes
      const job = buildExportJob({
        target,
        media,
        preset,
        chainParts,
        customizing: props.customizing,
        intensity,
        denoise,
        social,
        delivery,
        cutLevel: props.cutLevel,
        segments,
        cutting,
        look,
        // entra no p_ref para qualquer alvo (como antes); o render só usa no vídeo
        comparing,
        audiogram,
        music,
        library: props.library,
        buildId: process.env.NEXT_PUBLIC_BUILD_ID ?? "",
      });
      const resultKey = job.idempotency_ref;
      // trava: o p_ref do job tem de ser a mesma chave da tela (senão cobraria de novo quem já baixou)
      if (resultKey !== resultRef(settingsKey, target)) throw new Error("p_ref do pedido de exportação diferente da chave da tela");
      let out: { blob: Blob; filename: string } | undefined = unpaid.current?.key === resultKey ? unpaid.current.out : undefined;
      if (!out && props.serverExport && serverEligible(job) && (target !== "video" || (media.kind === "video" && media.videoContainer === "mp4" && !rendersVideo(job)))) {
        const ctrl = new AbortController();
        serverAbort.current = ctrl;
        try {
          const audio = await runServerExport(job, media, { signal: ctrl.signal, onPhase: (label, progress) => setPhase({ label, progress, server: true }) });
          if (target === "video") {
            const file = await readableFile(media.file);
            if (!file) throw new MediaError(FILE_GONE);
            out = await remuxVideoWithAudio({ file, audioStart: media.audioStart, videoContainer: media.videoContainer }, audio, (p) =>
              setPhase({ label: "Montando o vídeo com o som novo…", progress: p * 100 }),
            );
          } else {
            out = { blob: audio, filename: `${media.file.name.replace(/\.[^.]+$/, "").slice(0, 60) || "audio"}-mixpro.${target}` };
          }
        } catch (err) {
          if (err instanceof DOMException && err.name === "AbortError") {
            toast.info("Processamento cancelado. Nenhum crédito foi usado.");
            return;
          }
          if (err instanceof ServerExportError) {
            if (err.code === "INSUFFICIENT_CREDITS") return onNeedCredits();
            if (!err.device) {
              reportError("exportar", err, { severity: "aviso", context: { formato: target, codigo: err.code, onde: "servidor" } });
              toast.error(err.message);
              return;
            }
            // o aparelho assume: a pessoa só é avisada, sem texto técnico; o código vai para Admin → Logs
            reportError("exportar", err, { severity: "aviso", context: { formato: target, codigo: err.code, onde: "servidor → aparelho" } });
            toast.info("Vamos processar neste aparelho.");
          } else {
            // qualquer outra falha (por exemplo, ao juntar o vídeo) cai no caminho do aparelho
            reportError("exportar", err, { severity: "aviso", context: { formato: target, onde: "servidor/remux" } });
            toast.info("Vamos processar neste aparelho.");
          }
        } finally {
          serverAbort.current = null;
        }
      }
      if (!out) {
        out = await executeExportJob(job, {
          media,
          drumSamples,
          impulses,
          music: music?.channels ?? null,
          audiogramImage: audiogram?.image ?? null,
          cache,
          onPhase: (label, progress) => setPhase({ label, progress }),
        });
      }
      // no resultado do servidor o débito já foi feito lá: esta chamada usa a mesma chave, não cobra de novo e atualiza o saldo
      setPhase({ label: "Registrando o download…", progress: 100 });
      try {
        await spend(resultKey, target === "video" ? "video" : "audio");
      } catch (err) {
        if (err instanceof OfflineError) unpaid.current = { key: resultKey, out };
        throw err;
      }
      unpaid.current = null;
      // no celular, libera o áudio tratado da memória (gerar de novo é rápido; ficar com ele pode derrubar a página)
      if (isPhone()) cache.current = null;
      track("export", { target, preset: preset.slug, captions: Boolean(look.captions), music: Boolean(music), before_after: comparing });

      const url = URL.createObjectURL(out.blob);
      setResult({ url, blob: out.blob, filename: out.filename, target, key: settingsKey });
      if (!canShareFiles(new File([out.blob], out.filename, { type: out.blob.type }))) downloadBlob(out.blob, out.filename);
    } catch (err) {
      if (err instanceof NoCreditsError) onNeedCredits();
      else if (err instanceof OfflineError) {
        reportError("exportar", err, { severity: "aviso", context: { formato: target } });
        toast.error("Sem internet para registrar o download. O arquivo já está pronto: toque de novo quando a conexão voltar.");
      }
      else if (err instanceof NeedLoginError) void requireLogin("Entre na sua conta para baixar.");
      else if (isFileGone(err)) {
        reportError("exportar", err, { severity: "aviso", context: { formato: target, motivo: "arquivo apagado pelo sistema" } });
        toast.error(FILE_GONE);
      } else if (err instanceof MediaError) {
        reportError("exportar", err, { severity: "aviso", context: { formato: target, preset: preset.slug } });
        toast.error(err.message);
      } else {
        console.error("[export]", err);
        reportError("exportar", err, { context: { formato: target, preset: preset.slug, legendas: Boolean(look.captions), cortes: cutting } });
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
          <span className="block text-sm font-medium">Ajustar o volume final</span>
          <span className="block text-xs text-muted">
            Leva o {media.kind === "video" ? "vídeo" : "áudio"} ao volume do destino escolhido, com teto de pico em -1 dBFS.
          </span>
        </span>
      </label>
      {social && (
        <ul className="grid gap-2 sm:grid-cols-2" aria-label="Destino do volume">
          {DELIVERY_IDS.map((id) => {
            const d = DELIVERY_TARGETS[id];
            const on = delivery === id;
            return (
              <li key={id}>
                <button
                  type="button"
                  aria-pressed={on}
                  onClick={() => onDeliveryChange(id)}
                  className={cn("h-full w-full rounded-2xl border p-3 text-left transition", on ? "border-violet-400 bg-primary/12" : "border-border hover:bg-white/[0.04]")}
                >
                  <span className="block text-sm font-semibold">{d.label}</span>
                  <span className="block text-xs text-muted">{d.description}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

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
          {phase.server ? (
            <>
              <p className="text-xs text-subtle">O processamento acontece no servidor. Você pode esperar aqui; o resultado chega nesta tela.</p>
              <Button variant="secondary" size="sm" onClick={() => serverAbort.current?.abort()} className="self-start">
                Cancelar
              </Button>
            </>
          ) : (
            <p className="text-xs text-subtle">Tudo acontece no seu aparelho. Mantenha esta tela aberta e não troque de app até terminar.</p>
          )}
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
          delivery={delivery}
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
