"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Camera, Download, Loader2, Share2, Upload, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ProgressBar } from "@/components/ui/misc";
import { useToast } from "@/components/ui/toast";
import { DevBadge } from "@/components/premium/explainer";
import { cn } from "@/lib/cn";
import { audioContext, enableMediaPlayback } from "@/lib/audio/ab-engine";
import { alignCover, type AlignResult } from "@/lib/cover/align";
import { coverParts, mixCover, monoStems, playbackOnTimeline, sumStems, type CoverPart } from "@/lib/cover/mix";
import { coverChain, drumSound, DRUM_STYLES } from "@/lib/cover/sound";
import { integratedLoudness } from "@/lib/dsp/loudness";
import { runDsp } from "@/lib/dsp/runner";
import type { Signal } from "@/lib/dsp/types";
import { exportVideo, MediaError } from "@/lib/media/export";
import { loadMedia, type LoadedMedia } from "@/lib/media/load";
import { loadVS, type SavedVS } from "@/lib/vs/store";
import { clickTrack } from "@/lib/vs/tempo";
import { reportError } from "@/lib/error-log";
import { CoverRecorder } from "./cover-recorder";

type Done = { media: LoadedMedia; align: AlignResult; perf: Signal; playback: Signal; musicBase: number };

/** Prévia: o vídeo (mudo) e a mix tocando junto no navegador, com o equilíbrio e o ajuste fino ao vivo. */
function usePreview(video: React.RefObject<HTMLVideoElement | null>, done: Done | null, balanceDb: number, nudgeMs: number) {
  const nodes = useRef<{ perf: AudioBuffer; music: AudioBuffer; srcs: AudioBufferSourceNode[]; musicGain: GainNode | null } | null>(null);
  const balanceRef = useRef(balanceDb);
  const nudgeRef = useRef(nudgeMs);
  const restart = useRef<() => void>(() => {});
  useEffect(() => {
    if (!done) return;
    const ctx = audioContext();
    const toBuf = (x: Signal) => {
      const b = new AudioBuffer({ length: x[0].length, numberOfChannels: 2, sampleRate: done.media.sampleRate });
      b.copyToChannel(x[0] as Float32Array<ArrayBuffer>, 0);
      b.copyToChannel((x[1] ?? x[0]) as Float32Array<ArrayBuffer>, 1);
      return b;
    };
    nodes.current = { perf: toBuf(done.perf), music: toBuf(done.playback), srcs: [], musicGain: null };
    const stopAll = () => {
      for (const s of nodes.current?.srcs ?? []) {
        try {
          s.stop();
        } catch {}
      }
      if (nodes.current) nodes.current.srcs = [];
    };
    const start = () => {
      const v = video.current;
      const n = nodes.current;
      if (!v || !n) return;
      stopAll();
      enableMediaPlayback();
      void ctx.resume();
      const at = ctx.currentTime + 0.05;
      const master = ctx.createGain();
      master.gain.value = 0.5; // a prévia não passa pelo limitador: margem para não estourar
      master.connect(ctx.destination);
      const pg = ctx.createGain();
      const mg = ctx.createGain();
      pg.connect(master);
      mg.connect(master);
      mg.gain.value = done.musicBase * 10 ** (balanceRef.current / 20);
      n.musicGain = mg;
      const t = v.currentTime;
      const ps = ctx.createBufferSource();
      ps.buffer = n.perf;
      ps.connect(pg);
      ps.start(at, Math.min(t, n.perf.duration - 0.01));
      // ajuste fino: música adiantada (+) ou atrasada (−) em relação à performance
      const ms = ctx.createBufferSource();
      ms.buffer = n.music;
      ms.connect(mg);
      const mt = t - nudgeRef.current / 1000;
      if (mt >= 0) ms.start(at, Math.min(mt, n.music.duration - 0.01));
      else ms.start(at - mt, 0);
      n.srcs = [ps, ms];
    };
    const v = video.current;
    v?.addEventListener("play", start);
    v?.addEventListener("pause", stopAll);
    const onSeeked = () => v && !v.paused && start();
    v?.addEventListener("seeked", onSeeked);
    v?.addEventListener("ended", stopAll);
    restart.current = () => video.current && !video.current.paused && start();
    return () => {
      stopAll();
      v?.removeEventListener("play", start);
      v?.removeEventListener("pause", stopAll);
      v?.removeEventListener("ended", stopAll);
      v?.removeEventListener("seeked", onSeeked);
      nodes.current = null;
    };
  }, [done, video]);
  useEffect(() => {
    balanceRef.current = balanceDb;
    const g = nodes.current?.musicGain;
    if (g && done) g.gain.setTargetAtTime(done.musicBase * 10 ** (balanceDb / 20), audioContext().currentTime, 0.02);
  }, [balanceDb, done]);
  useEffect(() => {
    nudgeRef.current = nudgeMs;
    restart.current();
  }, [nudgeMs]);
}

export function CoverStudio() {
  const toast = useToast();
  const [vs, setVs] = useState<SavedVS | null | undefined>(undefined);
  const [partId, setPartId] = useState<string | null>(null);
  const [mode, setMode] = useState<"gravar" | "enviar">("gravar");
  const [stage, setStage] = useState<"escolher" | "gravar" | "processando" | "pronto">("escolher");
  const [progress, setProgress] = useState<{ label: string; value: number } | null>(null);
  const [done, setDone] = useState<Done | null>(null);
  const [balance, setBalance] = useState(0);
  const [nudge, setNudge] = useState(0);
  const [kit, setKit] = useState("poprock");
  const [studio, setStudio] = useState(60);
  const [exported, setExported] = useState<{ url: string; file: File } | null>(null);
  const [exporting, setExporting] = useState<number | null>(null);
  const last = useRef<{ file: File; estimate: number | null } | null>(null);
  const video = useRef<HTMLVideoElement>(null);
  const fileIn = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void loadVS().then(setVs);
  }, []);

  const parts = useMemo(() => coverParts(vs?.ids), [vs]);
  const part: CoverPart | null = parts.find((p) => p.id === partId) ?? parts[0] ?? null;

  // o que toca no fone na gravação (só quando for gravar: ocupa memória)
  const monitorData = useMemo(() => {
    if (!vs || !part || stage !== "gravar" || mode !== "gravar") return null;
    const n = vs.stems[0][0].length;
    const ck = clickTrack(vs.beats, n, vs.sampleRate);
    return {
      music: sumStems(vs.stems, part.stems),
      guide: sumStems(vs.stems, [], part.stems),
      click: Float32Array.from(ck, (v) => v / 32768),
    };
  }, [vs, part, stage, mode]);

  usePreview(video, done, balance, nudge);
  const videoUrl = useMemo(() => (done ? URL.createObjectURL(done.media.file) : null), [done]);
  useEffect(() => () => void (videoUrl && URL.revokeObjectURL(videoUrl)), [videoUrl]);

  async function process(file: File, estimate: number | null, opts: { kit: string; studio: number }) {
    if (!vs || !part) return;
    last.current = { file, estimate };
    setStage("processando");
    setExported(null);
    try {
      setProgress({ label: "Lendo o vídeo…", value: 0 });
      const media = await loadMedia(file, (v) => setProgress({ label: "Lendo o vídeo…", value: v * 15 }));
      setProgress({ label: "Sincronizando com a música…", value: 18 });
      await new Promise((r) => setTimeout(r, 30));
      const align = alignCover(media.channels, media.sampleRate, [monoStems(vs.stems, { only: part.stems })], [monoStems(vs.stems)], vs.sampleRate, estimate);
      setProgress({ label: `Deixando ${part.label.toLowerCase()} com som de estúdio…`, value: 25 });
      const drum = part.chain === "drums" ? await drumSound(opts.kit, media.sampleRate) : null;
      const r = await runDsp(
        {
          channels: media.channels,
          sampleRate: media.sampleRate,
          chain: coverChain(part.chain, { kit: opts.kit, studio: opts.studio, samples: drum?.choices }),
          intensity: 100,
          social: false,
          drumSamples: drum?.set,
        },
        (v) => setProgress({ label: `Deixando ${part.label.toLowerCase()} com som de estúdio…`, value: 25 + v * 60 }),
      );
      setProgress({ label: "Encaixando a música…", value: 88 });
      await new Promise((r2) => setTimeout(r2, 30));
      const playback = playbackOnTimeline(vs.stems, part.stems, vs.sampleRate, media.sampleRate, align.offsetS, media.channels[0].length);
      const lp = integratedLoudness(r.channels.length >= 2 ? r.channels : [r.channels[0], r.channels[0]], media.sampleRate);
      const lm = integratedLoudness(playback, media.sampleRate);
      const musicBase = Number.isFinite(lp) && Number.isFinite(lm) ? 10 ** ((lp - 1 - lm) / 20) : 1;
      setDone({ media, align, perf: r.channels, playback, musicBase });
      setNudge(0);
      setStage("pronto");
    } catch (e) {
      reportError("cover", e, { severity: "aviso" });
      toast.error(e instanceof MediaError || (e as Error).message?.length < 160 ? (e as Error).message : "Não conseguimos processar este vídeo. Tente de novo.");
      setStage("gravar");
    } finally {
      setProgress(null);
    }
  }

  async function exportNow() {
    if (!done || !vs || !part) return;
    setExporting(0);
    try {
      // ajuste fino: reposiciona a música (o resto já está pronto)
      const playback = nudge ? playbackOnTimeline(vs.stems, part.stems, vs.sampleRate, done.media.sampleRate, done.align.offsetS + nudge / 1000, done.media.channels[0].length) : done.playback;
      const mix = mixCover(done.perf, playback, done.media.sampleRate, balance);
      setExporting(5);
      const out = await exportVideo(done.media, mix.out, (v) => setExporting(5 + v * 95));
      const name = `cover-${(vs.name || "musica").replace(/[^\p{L}\p{N}]+/gu, "-").slice(0, 40)}-mixpro.${out.filename.endsWith(".webm") ? "webm" : "mp4"}`;
      const file = new File([out.blob], name, { type: out.blob.type });
      setExported({ url: URL.createObjectURL(out.blob), file });
    } catch (e) {
      reportError("cover-export", e, { severity: "aviso" });
      toast.error(e instanceof MediaError ? e.message : "Não conseguimos gerar o vídeo. Tente de novo.");
    } finally {
      setExporting(null);
    }
  }

  async function share() {
    if (!exported) return;
    const nav = navigator as Navigator & { canShare?: (d: { files: File[] }) => boolean };
    if (nav.canShare?.({ files: [exported.file] })) {
      await navigator.share({ files: [exported.file], title: "Meu cover" }).catch(() => {});
    } else toast.info?.("Baixe o vídeo e poste pelo Instagram.");
  }

  if (vs === undefined)
    return (
      <p className="flex items-center gap-2 text-sm text-muted">
        <Loader2 className="size-4 animate-spin" aria-hidden /> Carregando…
      </p>
    );

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-5">
      <header className="flex flex-col gap-2">
        <p className="flex items-center gap-2 text-xs uppercase tracking-wider text-violet-300">
          Modo Cover <DevBadge />
        </p>
        <h1 className="font-display text-2xl font-semibold">Grave você tocando a música e poste</h1>
        <p className="text-sm text-muted">
          O app tira o seu instrumento da música, toca o playback no seu fone (com clique, contagem e reforço de volume), sincroniza a sua gravação sozinho, deixa o som
          com cara de estúdio e entrega o vídeo pronto para o Instagram.
        </p>
      </header>

      {!vs ? (
        <Card className="flex flex-col gap-3 p-5">
          <p className="font-semibold">1. Primeiro, crie o VS da música</p>
          <p className="text-sm text-muted">O VS separa bateria, baixo, voz e instrumentos e cria o clique. Depois volte aqui: ele fica guardado no aparelho.</p>
          <Link href="/vs" className="bg-brand self-start rounded-full px-5 py-2.5 text-sm font-semibold text-white">
            Criar o VS
          </Link>
        </Card>
      ) : (
        <Card className="flex flex-col gap-3 p-5">
          <p className="text-sm font-semibold">1. Música: {vs.name}</p>
          <p className="text-xs text-muted">
            {vs.beats.bpm} BPM ·{" "}
            <Link href="/vs" className="underline">
              trocar a música
            </Link>
          </p>
          <p className="text-sm">O que você vai tocar?</p>
          <div className="flex flex-wrap gap-2">
            {parts.map((p) => (
              <button
                key={p.id}
                type="button"
                disabled={stage === "processando"}
                onClick={() => {
                  setPartId(p.id);
                  setStage("escolher");
                  setDone(null);
                }}
                className={cn("rounded-full border px-4 py-2 text-sm", part?.id === p.id ? "border-violet-400 bg-primary/15" : "border-border-strong hover:bg-white/5")}
              >
                {p.emoji} {p.label}
              </button>
            ))}
          </div>
          {stage === "escolher" && (
            <Button className="self-start" onClick={() => setStage("gravar")}>
              Continuar
            </Button>
          )}
        </Card>
      )}

      {vs && part && stage !== "escolher" && (
        <Card className="flex flex-col gap-4 p-5">
          <p className="text-sm font-semibold">2. Gravar</p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant={mode === "gravar" ? "primary" : "secondary"} onClick={() => setMode("gravar")} disabled={stage === "processando"}>
              <Camera className="size-4" aria-hidden /> Gravar aqui
            </Button>
            <Button size="sm" variant={mode === "enviar" ? "primary" : "secondary"} onClick={() => setMode("enviar")} disabled={stage === "processando"}>
              <Upload className="size-4" aria-hidden /> Enviar vídeo já gravado
            </Button>
          </div>
          {stage === "processando" && progress ? (
            <ProgressBar value={progress.value} label={progress.label} />
          ) : mode === "gravar" ? (
            monitorData && (
              <CoverRecorder
                music={monitorData.music}
                click={monitorData.click}
                guide={monitorData.guide}
                sr={vs.sampleRate}
                bpm={vs.beats.bpm}
                partLabel={part.label}
                onRecorded={(f, est) => void process(f, est, { kit, studio })}
              />
            )
          ) : (
            <div className="flex flex-col gap-2">
              <p className="text-sm text-muted">
                Grave com a câmera do celular tocando por cima da música (com fone, ou com a música numa caixa de som). Pode começar a gravar antes da música: o app acha o ponto
                certo sozinho.
              </p>
              <input
                ref={fileIn}
                type="file"
                accept="video/*,.mp4,.mov"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void process(f, null, { kit, studio });
                  e.target.value = "";
                }}
              />
              <Button className="self-start" onClick={() => fileIn.current?.click()}>
                <Upload className="size-4" aria-hidden /> Escolher o vídeo
              </Button>
            </div>
          )}
        </Card>
      )}

      {done && stage === "pronto" && part && (
        <Card className="flex flex-col gap-4 p-5">
          <p className="flex items-center gap-2 text-sm font-semibold">
            <Wand2 className="size-4 text-violet-300" aria-hidden /> 3. Ajuste e gere o vídeo
          </p>
          <video ref={video} src={videoUrl ?? undefined} muted playsInline controls className="mx-auto max-h-[70vh] w-full max-w-sm rounded-2xl bg-black" />
          <p className="text-xs text-muted">
            {done.align.by === "estimativa"
              ? "Não deu para conferir a sincronia pelas batidas: confira ouvindo e use o ajuste fino se precisar."
              : done.align.confidence >= 6
                ? "Sincronizado pelas batidas. Confira ouvindo."
                : "Sincronia encontrada, mas confira ouvindo (use o ajuste fino se precisar)."}
          </p>
          <label className="flex flex-col gap-1 text-sm">
            <span className="flex justify-between">
              <span>Equilíbrio</span>
              <span className="font-mono text-xs text-violet-200">{balance === 0 ? "padrão" : balance > 0 ? `música +${balance} dB` : `${part.label.toLowerCase()} +${-balance} dB`}</span>
            </span>
            <input type="range" min={-12} max={12} value={balance} onChange={(e) => setBalance(Number(e.target.value))} className="accent-violet-500" />
            <span className="flex justify-between text-xs text-subtle">
              <span>Mais {part.label.toLowerCase()}</span>
              <span>Mais música</span>
            </span>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="flex justify-between">
              <span>Ajuste fino da sincronia</span>
              <span className="font-mono text-xs text-violet-200">{nudge === 0 ? "automático" : `${nudge > 0 ? "+" : ""}${nudge} ms`}</span>
            </span>
            <input type="range" min={-200} max={200} step={5} value={nudge} onChange={(e) => setNudge(Number(e.target.value))} className="accent-violet-500" />
            <span className="text-xs text-subtle">Se a música parecer atrasada, puxe para a esquerda; adiantada, para a direita.</span>
          </label>
          {part.chain === "drums" && (
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="flex flex-col gap-1 text-sm">
                Timbre da bateria
                <select value={kit} onChange={(e) => setKit(e.target.value)} className="h-10 rounded-xl border border-border-strong bg-black/20 px-3">
                  {DRUM_STYLES.map((s) => (
                    <option key={s.value} value={s.value}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="flex justify-between">
                  <span>Som de estúdio</span>
                  <span className="font-mono text-xs text-violet-200">{studio}%</span>
                </span>
                <input type="range" min={0} max={100} value={studio} onChange={(e) => setStudio(Number(e.target.value))} className="accent-violet-500" />
              </label>
              <Button size="sm" variant="secondary" className="self-start" onClick={() => last.current && void process(last.current.file, last.current.estimate, { kit, studio })}>
                Aplicar timbre
              </Button>
            </div>
          )}
          {exporting !== null ? (
            <ProgressBar value={exporting} label="Gerando o vídeo…" />
          ) : exported ? (
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => void share()}>
                <Share2 className="size-4" aria-hidden /> Compartilhar (Instagram)
              </Button>
              <a href={exported.url} download={exported.file.name} className="inline-flex items-center gap-2 rounded-full border border-border-strong px-4 py-2 text-sm hover:bg-white/5">
                <Download className="size-4" aria-hidden /> Baixar o vídeo
              </a>
              <Button variant="secondary" onClick={() => setExported(null)}>
                Ajustar de novo
              </Button>
            </div>
          ) : (
            <Button size="lg" className="self-start" onClick={() => void exportNow()}>
              Gerar o vídeo para o Instagram
            </Button>
          )}
          {exported?.file.name.endsWith(".webm") && (
            <p className="text-xs text-amber-200/90">Este navegador gravou em WebM, que o Instagram pode recusar. No iPhone use o Safari; no Android, o Chrome atualizado.</p>
          )}
          <p className="text-xs text-subtle">Tudo acontece no seu aparelho: o vídeo não é enviado para o servidor.</p>
        </Card>
      )}
    </div>
  );
}
