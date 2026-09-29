"use client";

import { useEffect, useRef, useState } from "react";
import { Download, Film, Music, Share2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ProgressBar } from "@/components/ui/misc";
import { useToast } from "@/components/ui/toast";
import { NeedLoginError, NoCreditsError } from "@/lib/account";
import { runDsp, type DspResult } from "@/lib/dsp/runner";
import { exportAudio, exportVideo, type AudioFormat } from "@/lib/media/export";
import type { LoadedMedia } from "@/lib/media/load";
import type { StudioPreset } from "@/lib/presets";
import { cn } from "@/lib/cn";

export type Target = "video" | AudioFormat;
type Phase = { label: string; progress: number } | null;
type Result = { url: string; blob: Blob; filename: string; target: Target; key: string };

type Props = {
  media: LoadedMedia;
  preset: StudioPreset | null;
  intensity: number;
  social: boolean;
  onSocialChange: (v: boolean) => void;
  balance: number | null;
  /** Debita 1 crédito (lança NoCreditsError quando não há saldo). */
  spend: (ref: string, kind: "video" | "audio") => Promise<void>;
  onNeedCredits: () => void;
  signedIn: boolean;
  /** Pede login; o estúdio devolve o pedido em `autoStart` depois que a pessoa entrar. */
  onNeedLogin: (target: Target) => void;
  autoStart: Target | null;
  onAutoStarted: () => void;
};

function fileKey(f: File): string {
  let h = 0x811c9dc5;
  for (const ch of `${f.name}|${f.size}|${f.lastModified}`) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

const canShareFiles = (file: File) => typeof navigator !== "undefined" && !!navigator.canShare?.({ files: [file] });

export function ExportPanel({
  media,
  preset,
  intensity,
  social,
  onSocialChange,
  balance,
  spend,
  onNeedCredits,
  signedIn,
  onNeedLogin,
  autoStart,
  onAutoStarted,
}: Props) {
  const toast = useToast();
  const [phase, setPhase] = useState<Phase>(null);
  const [lastResult, setResult] = useState<Result | null>(null);
  const cache = useRef<{ key: string; value: DspResult } | null>(null);
  const settingsKey = preset ? `${fileKey(media.file)}_${preset.slug}_${intensity}_${social ? 1 : 0}` : null;

  useEffect(() => () => {
    if (lastResult) URL.revokeObjectURL(lastResult.url);
  }, [lastResult]);
  // Resultado antigo deixa de valer quando o arquivo/preset/ajustes mudam
  const result = lastResult?.key === settingsKey ? lastResult : null;

  async function processFull(): Promise<DspResult> {
    if (cache.current?.key === settingsKey) return cache.current.value;
    const value = await runDsp(
      { channels: media.channels, sampleRate: media.sampleRate, chain: preset!.chain, intensity, social },
      (p) => setPhase({ label: "Aplicando o preset no arquivo inteiro…", progress: p * 100 }),
    );
    cache.current = { key: settingsKey!, value };
    return value;
  }

  // Continua a exportação pedida antes do login
  useEffect(() => {
    if (!autoStart || !signedIn) return;
    const t = setTimeout(() => {
      onAutoStarted();
      void run(autoStart);
    });
    return () => clearTimeout(t);
  }, [autoStart, signedIn]); // eslint-disable-line react-hooks/exhaustive-deps

  async function run(target: Target) {
    if (!preset || !settingsKey || phase) return;
    if (!signedIn) return onNeedLogin(target);
    if (balance !== null && balance <= 0) return onNeedCredits();
    try {
      setPhase({ label: "Aplicando o preset no arquivo inteiro…", progress: 0 });
      const processed = await processFull();
      const label = target === "video" ? "Montando o vídeo com o som novo…" : "Gerando o arquivo de áudio…";
      setPhase({ label, progress: 0 });
      const onProgress = (p: number) => setPhase({ label, progress: p * 100 });
      const out =
        target === "video"
          ? await exportVideo(media, processed.channels, onProgress)
          : await exportAudio(media, processed.channels, target, onProgress);

      await spend(`${settingsKey}_${target}`, target === "video" ? "video" : "audio");

      const url = URL.createObjectURL(out.blob);
      setResult({ url, blob: out.blob, filename: out.filename, target, key: settingsKey });
      if (!canShareFiles(new File([out.blob], out.filename, { type: out.blob.type }))) triggerDownload(url, out.filename);
    } catch (err) {
      if (err instanceof NoCreditsError) onNeedCredits();
      else if (err instanceof NeedLoginError) onNeedLogin(target);
      else toast.error(err instanceof Error ? err.message : "Não foi possível gerar o arquivo.");
    } finally {
      setPhase(null);
    }
  }

  function triggerDownload(url: string, filename: string) {
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  async function shareResult() {
    if (!result) return;
    const file = new File([result.blob], result.filename, { type: result.blob.type });
    try {
      await navigator.share({ files: [file], title: "Mix Pro" });
    } catch (e) {
      if ((e as Error).name !== "AbortError") triggerDownload(result.url, result.filename);
    }
  }

  const isVideo = media.kind === "video";
  const busy = phase !== null;
  const shareable = result ? canShareFiles(new File([result.blob], result.filename, { type: result.blob.type })) : false;

  return (
    <div className="flex flex-col gap-4">
      <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-border p-3">
        <input
          type="checkbox"
          checked={social}
          onChange={(e) => onSocialChange(e.target.checked)}
          className="mt-1 size-4 accent-violet-500"
        />
        <span>
          <span className="block text-sm font-medium">Volume ideal para redes sociais</span>
          <span className="block text-xs text-muted">
            Ajusta para -14 LUFS, o padrão de Instagram, TikTok e YouTube. Seu vídeo não fica mais baixo que os outros.
          </span>
        </span>
      </label>

      {phase ? (
        <div className="flex flex-col gap-2 rounded-2xl bg-white/5 p-4" aria-live="polite">
          <p className="text-sm">{phase.label}</p>
          <ProgressBar value={phase.progress} label={phase.label} />
          <p className="text-xs text-subtle">Tudo acontece no seu aparelho. Mantenha esta tela aberta.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <Button size="lg" onClick={() => run(isVideo ? "video" : "mp3")} disabled={!preset || busy} className="w-full">
            {isVideo ? <Film className="size-5" /> : <Music className="size-5" />}
            {isVideo ? "Gerar vídeo pronto para postar" : "Gerar áudio pronto (MP3)"}
          </Button>
          <div className="grid grid-cols-3 gap-2">
            {(isVideo ? (["mp3", "wav", "m4a"] as const) : (["wav", "m4a"] as const)).map((f) => (
              <Button key={f} variant="secondary" size="sm" onClick={() => run(f)} disabled={!preset || busy}>
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
          <div className="grid gap-2 sm:grid-cols-2">
            {shareable && (
              <Button onClick={shareResult}>
                <Share2 className="size-4" /> Salvar ou postar
              </Button>
            )}
            <Button variant={shareable ? "secondary" : "primary"} onClick={() => triggerDownload(result.url, result.filename)}>
              <Download className="size-4" /> Baixar arquivo
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
