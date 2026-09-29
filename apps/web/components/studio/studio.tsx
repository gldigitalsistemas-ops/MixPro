"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FileAudio, FileVideo, LogOut, RefreshCw, ShieldCheck, Upload } from "lucide-react";
import { ABPlayer, type ABSource } from "@/components/audio/ab-player";
import { IntensitySelector } from "@/components/presets/intensity";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Logo, ProgressBar } from "@/components/ui/misc";
import { useToast } from "@/components/ui/toast";
import { NeedLoginError, useAccount } from "@/lib/account";
import { supabaseBrowser } from "@/lib/supabase/client";
import { cn, formatDuration } from "@/lib/cn";
import { integratedLoudness, waveformPeaks } from "@/lib/dsp/loudness";
import { DspAbortError, runDsp } from "@/lib/dsp/runner";
import { pickExcerpt, toAudioBuffer, type Excerpt } from "@/lib/media/excerpt";
import { loadMedia, MediaLoadError, type LoadedMedia } from "@/lib/media/load";
import { fetchPresets, type StudioCategory, type StudioPreset } from "@/lib/presets";
import type { Intensity } from "@mixpro/contracts";
import { drawCaptions, type CaptionRender } from "@/lib/captions/model";
import { captionFontFamily, ensureCaptionFont } from "@/lib/captions/font";
import { AuthModal } from "./auth-modal";
import { CaptionsPanel, type CaptionState } from "./captions-panel";
import { ExportPanel, type Target } from "./export-panel";
import { CreditsPill, InviteModal } from "./invite";
import { NOISE_AMOUNT, NoiseSelector, type NoiseLevel } from "./noise-selector";
import { PresetPicker } from "./preset-picker";

const ACCEPT = "video/*,audio/*,.mp4,.mov,.m4a,.mp3,.wav,.aac,.flac,.ogg,.webm";

function Steps() {
  const items = [
    ["1", "Escolha o vídeo ou áudio", "Direto da galeria. O arquivo não sai do seu aparelho."],
    ["2", "Toque num preset", "Voz de podcast, vocal, rap, instrumentos… e ouça antes e depois."],
    ["3", "Baixe pronto para postar", "Vídeo com som novo, ou só o áudio para o CapCut."],
  ];
  return (
    <ol className="grid gap-3 sm:grid-cols-3">
      {items.map(([n, t, d]) => (
        <li key={n} className="flex gap-3 rounded-2xl border border-border p-4">
          <span className="bg-brand grid size-8 shrink-0 place-items-center rounded-full text-sm font-bold text-white">{n}</span>
          <span>
            <span className="block text-sm font-semibold">{t}</span>
            <span className="block text-xs text-muted">{d}</span>
          </span>
        </li>
      ))}
    </ol>
  );
}

function useIsDesktop() {
  const [desktop, setDesktop] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    const update = () => setDesktop(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return desktop;
}

export function Studio() {
  const toast = useToast();
  const { user, account, unavailable, favorites, spend, toggleFavorite, refresh, signOut } = useAccount();
  const [invite, setInvite] = useState<null | "info" | "no-credits">(null);
  const [auth, setAuth] = useState<{ reason: string | null } | null>(null);
  const [pendingExport, setPendingExport] = useState<Target | null>(null);
  const [monthlyCredits, setMonthlyCredits] = useState(10);

  const [catalog, setCatalog] = useState<{ presets: StudioPreset[]; categories: StudioCategory[] } | null>(null);
  const [catalogError, setCatalogError] = useState(false);

  const [media, setMedia] = useState<LoadedMedia | null>(null);
  const [loading, setLoading] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const [categoryId, setCategoryId] = useState<string | null>(null);
  // Escolhas do usuário; null = usar o padrão (preset sugerido / intensidade do preset)
  const [chosenPreset, setPreset] = useState<StudioPreset | null>(null);
  const [chosenIntensity, setIntensity] = useState<Intensity | null>(null);
  const [social, setSocial] = useState(true);
  const [chosenNoise, setNoise] = useState<NoiseLevel | null>(null);
  const [captionState, setCaptionState] = useState<CaptionState | null>(null);

  const [excerpt, setExcerpt] = useState<Excerpt | null>(null);
  const [original, setOriginal] = useState<ABSource | null>(null);
  const [processed, setProcessed] = useState<ABSource | null>(null);
  const [previewBusy, setPreviewBusy] = useState<string | null>(null);
  const isDesktop = useIsDesktop();

  const loadCatalog = useCallback(
    () =>
      fetchPresets()
        .then((c) => {
          setCatalog(c);
          setCatalogError(false);
        })
        .catch(() => setCatalogError(true)),
    [],
  );
  useEffect(() => {
    void loadCatalog();
    supabaseBrowser()
      .from("system_settings")
      .select("value")
      .eq("key", "monthly_free_credits")
      .maybeSingle()
      .then(({ data }) => data && setMonthlyCredits(Number(data.value)));
  }, [loadCatalog]);

  const videoUrl = useMemo(() => (media?.kind === "video" ? URL.createObjectURL(media.file) : null), [media]);
  useEffect(() => () => {
    if (videoUrl) URL.revokeObjectURL(videoUrl);
  }, [videoUrl]);

  const choosePreset = useCallback((p: StudioPreset) => {
    setPreset(p);
    setCategoryId(p.categoryId);
    setIntensity(null);
  }, []);

  // Preset sugerido: voz falada para vídeos, vocal para áudios
  const preset = useMemo(() => {
    if (chosenPreset || !media || !catalog) return chosenPreset;
    const byCat = (id: string) => catalog.presets.find((p) => p.categoryId === id);
    return (media.kind === "video" ? byCat("vocal-podcast") : null) ?? byCat("vocal-pop") ?? catalog.presets[0] ?? null;
  }, [chosenPreset, media, catalog]);
  // Vídeos quase sempre têm ruído de ambiente; áudios de estúdio não
  const noise: NoiseLevel = chosenNoise ?? (media?.kind === "video" ? "light" : "off");
  const denoiseAmount = NOISE_AMOUNT[noise];
  const intensity: Intensity =
    chosenIntensity ?? ([25, 50, 75, 100].includes(preset?.defaultIntensity ?? 0) ? (preset!.defaultIntensity as Intensity) : 50);

  async function openFile(file: File) {
    setLoading(0);
    setMedia(null);
    setProcessed(null);
    setOriginal(null);
    setPreset(null);
    setIntensity(null);
    setCategoryId(null);
    setNoise(null);
    setCaptionState(null);
    try {
      const m = await loadMedia(file, (p) => setLoading(p * 100));
      const ex = pickExcerpt(m.channels, m.sampleRate);
      const a = m.channels.map((c) => c.slice(ex.start, ex.end));
      setExcerpt(ex);
      setOriginal({
        key: `orig-${file.name}-${file.size}-${file.lastModified}`,
        buffer: toAudioBuffer(a, m.sampleRate),
        peaks: waveformPeaks(a),
        lufs: integratedLoudness(a, m.sampleRate),
      });
      setMedia(m);
    } catch (err) {
      toast.error(err instanceof MediaLoadError ? err.message : "Não foi possível abrir esse arquivo.");
    } finally {
      setLoading(null);
    }
  }

  // Prévia do trecho com o preset atual (cancela a anterior se o usuário trocar rápido)
  useEffect(() => {
    if (!media || !excerpt || !preset) return;
    const ctrl = new AbortController();
    const timer = setTimeout(() => {
      setPreviewBusy("Aplicando o preset…");
      const from = excerpt.start - excerpt.preroll;
      runDsp(
        {
          channels: media.channels.map((c) => c.subarray(from, excerpt.end)),
          sampleRate: media.sampleRate,
          chain: preset.chain,
          intensity,
          social,
          denoise: denoiseAmount,
          preroll: excerpt.preroll,
        },
        (p) => setPreviewBusy(`${denoiseAmount > 0 && p < 0.5 ? "Removendo ruído" : "Aplicando o preset"}… ${Math.round(p * 100)}%`),
        ctrl.signal,
      )
        .then((r) => {
          setProcessed({
            key: `${preset.id}-${intensity}-${social}-${denoiseAmount}`,
            buffer: toAudioBuffer(r.channels, media.sampleRate),
            peaks: waveformPeaks(r.channels),
            lufs: r.lufs,
          });
          setPreviewBusy(null);
        })
        .catch((err) => {
          if (err instanceof DspAbortError) return;
          setPreviewBusy(null);
          toast.error("Não foi possível aplicar este preset. Tente outro.");
        });
    }, 150);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [media, excerpt, preset, intensity, social, denoiseAmount]); // eslint-disable-line react-hooks/exhaustive-deps

  const captionRender = useMemo<CaptionRender | null>(
    () =>
      captionState
        ? {
            captions: captionState.captions,
            style: captionState.style,
            position: captionState.position,
            fontFamily: captionFontFamily(),
          }
        : null,
    [captionState],
  );
  useEffect(() => {
    if (captionRender) void ensureCaptionFont();
  }, [captionRender]);
  const overlay = useMemo(
    () =>
      captionRender
        ? (ctx: CanvasRenderingContext2D, w: number, h: number, t: number) => drawCaptions(ctx, w, h, t, captionRender)
        : null,
    [captionRender],
  );

  const onToggleFavorite = useCallback(
    (p: StudioPreset) => {
      toggleFavorite(p.id).catch((err) => {
        if (err instanceof NeedLoginError) setAuth({ reason: "Entre para salvar seus presets favoritos na sua conta." });
        else toast.error("Não foi possível salvar o favorito.");
      });
    },
    [toggleFavorite, toast],
  );

  const onAuthDone = useCallback(async () => {
    setAuth(null);
    await refresh();
    toast.success("Pronto! Você está conectado.");
  }, [refresh, toast]);

  const pick = () => inputRef.current?.click();

  const exportCard = media && (
    <Card className="p-4">
      <h2 className="mb-3 font-display text-lg font-semibold">Baixar</h2>
      <ExportPanel
        media={media}
        preset={preset}
        intensity={intensity}
        denoise={denoiseAmount}
        captions={media.kind === "video" && captionState?.burnIn ? captionRender : null}
        social={social}
        onSocialChange={setSocial}
        balance={account?.balance ?? null}
        spend={spend}
        onNeedCredits={() => setInvite("no-credits")}
        signedIn={Boolean(user)}
        onNeedLogin={(target) => {
          setPendingExport(target);
          setAuth({ reason: `Crie sua conta grátis para baixar: são ${monthlyCredits} downloads por mês.` });
        }}
        autoStart={pendingExport}
        onAutoStarted={() => setPendingExport(null)}
      />
    </Card>
  );

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="mx-auto flex w-full max-w-6xl items-center justify-between gap-3 px-4 py-4 md:px-8">
        <Logo />
        {user ? (
          <div className="flex items-center gap-2">
            <CreditsPill account={account} onClick={() => setInvite("info")} />
            <button
              onClick={() => void signOut()}
              title={`Sair (${user.email ?? ""})`}
              aria-label="Sair da conta"
              className="grid size-9 place-items-center rounded-full border border-border-strong text-muted transition hover:bg-white/5 hover:text-text"
            >
              <LogOut className="size-4" />
            </button>
          </div>
        ) : (
          <Button size="sm" variant="secondary" onClick={() => setAuth({ reason: null })}>
            Entrar
          </Button>
        )}
      </header>

      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) void openFile(f);
        }}
      />

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 pb-16 md:px-8">
        {!media ? (
          <section className="flex flex-col gap-8 pt-4 md:pt-10">
            <div className="mx-auto flex max-w-2xl flex-col items-center gap-4 text-center">
              <h1 className="font-display text-3xl font-bold leading-tight tracking-tight md:text-5xl">
                Som de estúdio nos seus vídeos, <span className="text-gradient">em um toque.</span>
              </h1>
              <p className="max-w-lg text-muted md:text-lg">
                Envie o vídeo ou áudio, escolha um preset profissional, compare antes e depois e baixe pronto para postar.
                Grátis.
              </p>
            </div>

            <button
              onClick={pick}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                const f = e.dataTransfer.files?.[0];
                if (f) void openFile(f);
              }}
              disabled={loading !== null}
              className={cn(
                "glass mx-auto flex w-full max-w-2xl flex-col items-center gap-4 rounded-3xl border-2 border-dashed px-6 py-12 transition",
                dragOver ? "border-violet-400 bg-primary/10" : "border-border-strong hover:border-violet-400/60",
              )}
            >
              {loading !== null ? (
                <div className="flex w-full max-w-xs flex-col items-center gap-3">
                  <p className="text-sm">Lendo o áudio do arquivo…</p>
                  <ProgressBar value={loading} label="Lendo o arquivo" />
                </div>
              ) : (
                <>
                  <span className="bg-brand grid size-16 place-items-center rounded-2xl text-white shadow-[0_8px_30px_-6px_rgb(124_58_237/0.7)]">
                    <Upload className="size-7" />
                  </span>
                  <span className="font-display text-xl font-semibold">Escolher vídeo ou áudio</span>
                  <span className="flex items-center gap-4 text-xs text-muted">
                    <span className="flex items-center gap-1">
                      <FileVideo className="size-4" /> MP4, MOV
                    </span>
                    <span className="flex items-center gap-1">
                      <FileAudio className="size-4" /> MP3, WAV, M4A
                    </span>
                  </span>
                </>
              )}
            </button>

            <p className="flex items-center justify-center gap-2 text-center text-xs text-muted">
              <ShieldCheck className="size-4 text-green-400" /> Seu arquivo é processado no seu aparelho e não é enviado para
              nenhum servidor.
            </p>
            <Steps />
          </section>
        ) : (
          <section className="grid grid-cols-[minmax(0,1fr)] gap-6 pt-2 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <div className="flex flex-col gap-6">
              <Card className="flex items-center gap-3 p-3">
                <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-white/5">
                  {media.kind === "video" ? <FileVideo className="size-5" /> : <FileAudio className="size-5" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{media.file.name}</span>
                  <span className="text-xs text-muted">
                    {media.kind === "video" ? "Vídeo" : "Áudio"} · {formatDuration(media.duration)}
                  </span>
                </span>
                <Button variant="ghost" size="sm" onClick={pick} disabled={loading !== null}>
                  <RefreshCw className="size-4" /> Trocar
                </Button>
              </Card>

              <Card className="p-4">
                <h2 className="mb-3 font-display text-lg font-semibold">Ouça antes e depois</h2>
                <ABPlayer
                  original={original}
                  processed={processed}
                  busy={previewBusy ?? (!processed ? "Escolha um preset" : null)}
                  offsetSeconds={excerpt ? excerpt.start / media.sampleRate : 0}
                  videoUrl={videoUrl}
                  overlay={overlay}
                />
              </Card>

              {isDesktop && exportCard}
            </div>

            <div className="flex flex-col gap-6">
              <Card className="p-4">
                <h2 className="mb-3 font-display text-lg font-semibold">Escolha o som</h2>
                {catalog ? (
                  <PresetPicker
                    presets={catalog.presets}
                    categories={catalog.categories}
                    categoryId={categoryId ?? preset?.categoryId ?? null}
                    onCategory={setCategoryId}
                    selectedId={preset?.id ?? null}
                    onSelect={choosePreset}
                    favorites={favorites}
                    onToggleFavorite={onToggleFavorite}
                  />
                ) : catalogError ? (
                  <div className="flex flex-col items-center gap-3 py-6 text-center text-sm text-muted">
                    Não foi possível carregar os presets. Verifique sua internet.
                    <Button variant="secondary" size="sm" onClick={loadCatalog}>
                      Tentar de novo
                    </Button>
                  </div>
                ) : (
                  <p className="py-6 text-center text-sm text-muted">Carregando presets…</p>
                )}
              </Card>

              <Card className="p-4">
                <NoiseSelector value={noise} onChange={setNoise} />
              </Card>

              <Card className="p-4">
                <IntensitySelector value={intensity} onChange={setIntensity} disabled={!preset} />
              </Card>

              <Card className="p-4">
                <h2 className="mb-3 font-display text-lg font-semibold">Legendas automáticas</h2>
                <CaptionsPanel media={media} value={captionState} onChange={setCaptionState} />
              </Card>

              {!isDesktop && exportCard}
            </div>
          </section>
        )}
      </main>

      <footer className="border-t border-border px-4 py-6 text-center text-xs text-subtle">
        Mix Pro · <a href="/termos" className="hover:text-text">Termos</a> ·{" "}
        <a href="/privacidade" className="hover:text-text">Privacidade</a>
        {unavailable && <span className="block pt-1">Créditos indisponíveis no momento — os downloads seguem liberados.</span>}
      </footer>

      <AuthModal
        open={auth !== null}
        onClose={() => {
          setAuth(null);
          setPendingExport(null);
        }}
        onDone={() => void onAuthDone()}
        monthlyCredits={monthlyCredits}
        reason={auth?.reason}
      />

      <InviteModal
        open={invite !== null}
        onClose={() => setInvite(null)}
        account={account}
        reason={invite === "no-credits" ? "no-credits" : null}
      />
    </div>
  );
}
