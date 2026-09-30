"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Captions, Clapperboard, Download, FileAudio, FileVideo, RefreshCw, ShieldCheck, SlidersHorizontal, Upload } from "lucide-react";
import { ABPlayer, type ABSource } from "@/components/audio/ab-player";
import { IntensitySelector } from "@/components/presets/intensity";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ProgressBar } from "@/components/ui/misc";
import { useToast } from "@/components/ui/toast";
import { NeedLoginError } from "@/lib/account";
import { useAccountCtx } from "@/components/account/account-provider";
import { takeSharedFile } from "@/components/pwa/pwa";
import { cn, formatDuration } from "@/lib/cn";
import { integratedLoudness, waveformPeaks } from "@/lib/dsp/loudness";
import { DspAbortError, runDsp } from "@/lib/dsp/runner";
import { pickExcerpt, toAudioBuffer, type Excerpt } from "@/lib/media/excerpt";
import { loadMedia, MediaLoadError, type LoadedMedia } from "@/lib/media/load";
import { fetchPresets, type StudioCategory, type StudioPreset } from "@/lib/presets";
import type { Intensity } from "@mixpro/contracts";
import { drawCaptions, type CaptionRender } from "@/lib/captions/model";
import { captionFontFamily, ensureCaptionFont } from "@/lib/captions/font";
import { CaptionsPanel, type CaptionState } from "./captions-panel";
import { ExportPanel } from "./export-panel";
import { StyleBar } from "./style-bar";
import { MusicPicker, type MusicState } from "./music-picker";
import { DrumPanel, drumDefaults, withDrumTweaks, type DrumTweaks } from "./drum-panel";
import { mixMusic, safeCeiling } from "@/lib/media/music";
import { VideoTools, defaultVideoTools, type VideoToolsState } from "./video-tools";
import { mapToOutput, speechSegments } from "@/lib/media/cuts";
import type { Look } from "@/lib/media/compose";
import type { StyleSettings } from "@/lib/styles";
import { allWords, buildCaptions, type CaptionStyleId, type CaptionPosition } from "@/lib/captions/model";
import { NOISE_AMOUNT, NoiseSelector, type NoiseLevel } from "./noise-selector";
import { PresetPicker } from "./preset-picker";
import { StudioTour } from "./tour";
import { CustomizePanel } from "./customize-panel";
import { AutoSetupCard } from "./auto-setup-card";
import { analyzeAudio } from "@/lib/dsp/analyze";
import { autoSetup, pickPreset, type AutoSetup } from "@/lib/auto-setup";
import { track } from "@/lib/track";
import type { ChainDoc } from "@/lib/dsp/chain";
import type { DrumSampleSet } from "@/lib/dsp/drums/studio";
import {
  fetchDrumKits,
  fetchDrumLibrary,
  fetchIRs,
  fetchUnlockedKits,
  loadIR,
  loadSampleSet,
  lockedKitsFor,
  unlockKit,
  type CabIR,
  type DrumKit,
  type DrumLibraryItem,
} from "@/lib/drums/library";
import {
  deleteUserPreset,
  freezeChain,
  getSharedPreset,
  listUserPresets,
  PresetLimitError,
  saveUserPreset,
  sharedToStudioPreset,
  shareUserPreset,
} from "@/lib/user-presets";

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

type Tab = "som" | "legendas" | "video" | "baixar";

const TABS: { id: Tab; label: string; audioLabel?: string; icon: typeof SlidersHorizontal }[] = [
  { id: "som", label: "Som", icon: SlidersHorizontal },
  { id: "legendas", label: "Legendas", icon: Captions },
  { id: "video", label: "Vídeo", audioLabel: "Edição", icon: Clapperboard },
  { id: "baixar", label: "Baixar", icon: Download },
];

export function Studio() {
  const toast = useToast();
  const { user, account, favorites, spend, toggleFavorite, requireLogin, showNoCredits, refresh } = useAccountCtx();
  const [tab, setTab] = useState<Tab>("som");

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
  const [videoTools, setVideoTools] = useState<VideoToolsState | null>(null);
  const [music, setMusic] = useState<MusicState | null>(null);
  const [drumTweaks, setDrumTweaks] = useState<DrumTweaks | null>(null);
  const [drumLibrary, setDrumLibrary] = useState<DrumLibraryItem[] | null>(null);
  const [drumSet, setDrumSet] = useState<{ key: string; set: DrumSampleSet } | null>(null);
  const [drumKits, setDrumKits] = useState<DrumKit[]>([]);
  const [unlockedList, setUnlocked] = useState<Set<string>>(new Set());
  const [irList, setIrList] = useState<CabIR[] | null>(null);
  const [irSet, setIrSet] = useState<{ key: string; map: Record<string, Float32Array> } | null>(null);
  // prévia do arquivo inteiro (em vez do melhor trecho de 20 s)
  const [fullPreview, setFullPreview] = useState(false);
  // ajuste automático: o que a análise encontrou no arquivo e o que ela escolheu
  const [auto, setAuto] = useState<AutoSetup | null>(null);
  // "Personalizar": cadeia editada pelo usuário (vale enquanto o mesmo preset estiver escolhido)
  const [custom, setCustom] = useState<{ presetId: string; chain: ChainDoc } | null>(null);
  const [userPresetList, setUserPresets] = useState<StudioPreset[]>([]);
  // preferências de legenda vindas de "Meu estilo" (usadas quando as legendas forem geradas)
  const [captionPrefs, setCaptionPrefs] = useState<{ style: CaptionStyleId; position: CaptionPosition } | null>(null);

  const [excerpt, setExcerpt] = useState<Excerpt | null>(null);
  const [original, setOriginal] = useState<ABSource | null>(null);
  const [processed, setProcessed] = useState<ABSource | null>(null);
  const [previewBusy, setPreviewBusy] = useState<string | null>(null);

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
    track("studio_open");
  }, [loadCatalog]);

  // Vídeo recebido pelo menu "Compartilhar" da galeria (app instalado)
  useEffect(() => {
    if (!window.location.search.includes("compartilhado=1")) return;
    window.history.replaceState(null, "", "/estudio");
    takeSharedFile()
      .then((f) => f && void openFile(f))
      .catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Preset compartilhado por link (/p/<código> → /estudio?preset=<código>)
  useEffect(() => {
    const code = new URLSearchParams(window.location.search).get("preset");
    if (!code) return;
    window.history.replaceState(null, "", "/estudio");
    getSharedPreset(code)
      .then((s) => {
        if (!s) return toast.error("Esse link de preset não existe mais.");
        setPreset(sharedToStudioPreset(code, s));
        setCategoryId(s.category_id);
        track("shared_preset_opened", { code });
        toast.success(`Timbre “${s.name}” carregado. Escolha seu vídeo ou áudio para ouvir.`);
      })
      .catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const videoUrl = useMemo(() => (media?.kind === "video" ? URL.createObjectURL(media.file) : null), [media]);
  useEffect(() => () => {
    if (videoUrl) URL.revokeObjectURL(videoUrl);
  }, [videoUrl]);

  const choosePreset = useCallback((p: StudioPreset) => {
    setPreset(p);
    setCategoryId(p.categoryId);
    setIntensity(null);
    setDrumTweaks(null);
    setCustom(null);
  }, []);

  // presets personalizados da conta
  useEffect(() => {
    if (!user) return;
    listUserPresets()
      .then(setUserPresets)
      .catch(() => {});
  }, [user]);
  const userPresets = useMemo(() => (user ? userPresetList : []), [user, userPresetList]);

  // Preset sugerido: voz falada para vídeos, vocal para áudios
  const preset = useMemo(() => {
    if (chosenPreset || !media || !catalog) return chosenPreset;
    // preset escolhido pela análise automática do arquivo (ou o padrão por tipo de mídia)
    const fallback = media.kind === "video" ? ["vocal-criador", "vocal-podcast", "vocal-pop"] : ["vocal-pop"];
    return pickPreset(catalog.presets, [...(auto?.categories ?? []), ...fallback]) ?? catalog.presets[0] ?? null;
  }, [chosenPreset, media, catalog, auto]);
  // cadeia base: a do preset, ou a que o usuário está personalizando
  const baseChain = custom && preset && custom.presetId === preset.id ? custom.chain : (preset?.chain ?? null);
  // com a cadeia personalizada os valores já estão fixos (congelados na intensidade escolhida)
  const customizing = baseChain !== null && baseChain !== preset?.chain;

  // Bateria de estúdio: samples escolhidos e ajustes entram na cadeia do preset
  const drumParams = useMemo(
    () => (baseChain?.chain.find((m) => m.type === "drum_studio")?.params as Record<string, unknown> | undefined) ?? null,
    [baseChain],
  );
  useEffect(() => {
    if (!drumParams || drumLibrary) return;
    Promise.all([fetchDrumLibrary(), fetchDrumKits()])
      .then(([lib, kits]) => {
        setDrumKits(kits);
        setDrumLibrary(lib);
      })
      .catch(() => setDrumLibrary([]));
  }, [drumParams, drumLibrary]);
  // kits premium que a pessoa já desbloqueou
  useEffect(() => {
    if (!user || !drumKits.some((k) => k.price_credits > 0)) return;
    fetchUnlockedKits()
      .then(setUnlocked)
      .catch(() => {});
  }, [user, drumKits]);
  const unlocked = useMemo(() => (user ? unlockedList : new Set<string>()), [user, unlockedList]);
  const drumBase = useMemo(() => (drumParams ? drumDefaults(drumParams, drumLibrary ?? [], drumKits) : null), [drumParams, drumLibrary, drumKits]);
  const drumEff = drumParams ? (drumTweaks ?? drumBase) : null;
  const chain = useMemo(() => (baseChain ? withDrumTweaks(baseChain, drumEff) : null), [baseChain, drumEff]);

  // baixa os samples escolhidos (uma vez por peça; ficam em memória)
  const drumKey = drumEff && drumLibrary && media ? `${JSON.stringify(drumEff.samples)}@${media.sampleRate}` : null;
  useEffect(() => {
    if (!drumKey || !drumEff || !drumLibrary || !media) return;
    let alive = true;
    loadSampleSet(drumEff.samples, drumLibrary, media.sampleRate)
      .then((set) => alive && setDrumSet({ key: drumKey, set }))
      .catch(() => {
        if (!alive) return;
        setDrumSet({ key: drumKey, set: {} });
        toast.error("Não foi possível baixar os samples de bateria. Usando o timbre sintetizado.");
      });
    return () => {
      alive = false;
    };
  }, [drumKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const drumReady = !drumParams || (drumLibrary !== null && drumSet?.key === drumKey);
  const drumSamples = drumParams && drumSet?.key === drumKey ? drumSet.set : undefined;
  const lockedKits = useMemo(
    () => (drumEff && drumLibrary ? lockedKitsFor(drumEff.samples, drumKits, unlocked) : []),
    [drumEff, drumLibrary, drumKits, unlocked],
  );

  // Amplificador com caixa gravada (IR): baixa as IRs usadas pela cadeia
  const irIds = useMemo(
    () => [...new Set((chain?.chain ?? []).filter((m) => m.type === "amp" && m.params?.ir).map((m) => String(m.params!.ir)))].sort(),
    [chain],
  );
  const usesAmp = Boolean(chain?.chain.some((m) => m.type === "amp"));
  useEffect(() => {
    if (!usesAmp || irList) return;
    fetchIRs()
      .then(setIrList)
      .catch(() => setIrList([]));
  }, [usesAmp, irList]);
  const irKey = irIds.length && media ? `${irIds.join(",")}@${media.sampleRate}` : "";
  useEffect(() => {
    if (!irKey || !irList || !media) return;
    let alive = true;
    Promise.all(irIds.map(async (id) => [id, await loadIR(irList.find((x) => x.id === id)!, media.sampleRate)] as const))
      .then((pairs) => alive && setIrSet({ key: irKey, map: Object.fromEntries(pairs) }))
      .catch(() => {
        if (!alive) return;
        setIrSet({ key: irKey, map: {} });
        toast.error("Não foi possível baixar a caixa gravada. Usando a caixa simulada.");
      });
    return () => {
      alive = false;
    };
  }, [irKey, irList?.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const irReady = !irKey || (irList !== null && (irIds.every((id) => !irList.some((x) => x.id === id)) || irSet?.key === irKey));
  const impulses = irKey && irSet?.key === irKey ? irSet.map : undefined;
  const assetsReady = drumReady && irReady;

  // Vídeos quase sempre têm ruído de ambiente; áudios de estúdio não
  // remoção de ruído só onde tem voz (em música e instrumentos ela estraga o som)
  const noise: NoiseLevel = chosenNoise ?? auto?.noise ?? "off";
  const denoiseAmount = NOISE_AMOUNT[noise];
  const intensity: Intensity =
    chosenIntensity ?? ([25, 50, 75, 100].includes(preset?.defaultIntensity ?? 0) ? (preset!.defaultIntensity as Intensity) : 50);
  const dspIntensity = customizing ? 100 : intensity;

  /** Trecho que toca na prévia antes/depois (o "antes" é o mesmo trecho do original). */
  function applyExcerpt(m: LoadedMedia, ex: Excerpt) {
    const a = m.channels.map((c) => c.slice(ex.start, ex.end));
    setExcerpt(ex);
    setOriginal({
      key: `orig-${m.file.name}-${m.file.size}-${m.file.lastModified}-${ex.start}-${ex.end}`,
      buffer: toAudioBuffer(a, m.sampleRate),
      peaks: waveformPeaks(a),
      lufs: integratedLoudness(a, m.sampleRate),
    });
  }

  /** Alterna entre o melhor trecho de 20 s e o arquivo inteiro. */
  function toggleFullPreview() {
    if (!media) return;
    const next = !fullPreview;
    setFullPreview(next);
    setProcessed(null);
    applyExcerpt(media, next ? { start: 0, end: media.channels[0].length, preroll: 0 } : pickExcerpt(media.channels, media.sampleRate));
  }

  async function openFile(file: File) {
    setLoading(0);
    setMedia(null);
    setProcessed(null);
    setOriginal(null);
    // preset vindo de um link compartilhado continua escolhido; os outros voltam ao sugerido
    const keep = chosenPreset?.id.startsWith("s-");
    if (!keep) {
      setPreset(null);
      setCategoryId(null);
    }
    setIntensity(null);
    setNoise(null);
    setCaptionState(null);
    setVideoTools(null);
    setMusic(null);
    setDrumTweaks(null);
    setCustom(null);
    setFullPreview(false);
    setTab("som");
    try {
      const m = await loadMedia(file, (p) => setLoading(p * 100));
      applyExcerpt(m, pickExcerpt(m.channels, m.sampleRate));
      let setup: AutoSetup | null = null;
      try {
        setup = autoSetup(analyzeAudio(m.channels, m.sampleRate), m.kind);
      } catch {
        // análise é só uma ajuda: sem ela, valem os padrões
      }
      setAuto(setup);
      setVideoTools(defaultVideoTools(m));
      setMedia(m);
      track("file_loaded", { kind: m.kind, seconds: Math.round(m.duration), content: setup?.kind ?? "?" });
    } catch (err) {
      toast.error(err instanceof MediaLoadError ? err.message : "Não foi possível abrir esse arquivo.");
    } finally {
      setLoading(null);
    }
  }

  // Prévia do trecho com o preset atual (cancela a anterior se o usuário trocar rápido)
  useEffect(() => {
    if (!media || !excerpt || !preset || !chain || !assetsReady) return;
    const ctrl = new AbortController();
    const timer = setTimeout(() => {
      setPreviewBusy("Aplicando o preset…");
      const from = excerpt.start - excerpt.preroll;
      runDsp(
        {
          channels: media.channels.map((c) => c.subarray(from, excerpt.end)),
          sampleRate: media.sampleRate,
          chain,
          intensity: dspIntensity,
          social,
          denoise: denoiseAmount,
          preroll: excerpt.preroll,
          drumSamples,
          impulses,
        },
        (p) => setPreviewBusy(`${denoiseAmount > 0 && p < 0.5 ? "Removendo ruído" : "Aplicando o preset"}… ${Math.round(p * 100)}%`),
        ctrl.signal,
      )
        .then((r) => {
          const out = music
            ? safeCeiling(
                mixMusic(r.channels, music.channels, media.sampleRate, music.level, excerpt.start, media.channels[0].length),
                media.sampleRate,
              )
            : r.channels;
          setProcessed({
            key: `${preset.id}-${dspIntensity}-${social}-${denoiseAmount}-${music ? `${music.name}-${music.level}` : ""}-${JSON.stringify(chain)}`,
            buffer: toAudioBuffer(out, media.sampleRate),
            peaks: waveformPeaks(out),
            lufs: music ? integratedLoudness(out, media.sampleRate) : r.lufs,
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
  }, [media, excerpt, preset, chain, dspIntensity, social, denoiseAmount, music, assetsReady, drumSamples, impulses]); // eslint-disable-line react-hooks/exhaustive-deps

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

  const words = useMemo(() => (captionState ? allWords(captionState.captions) : null), [captionState]);
  const segments = useMemo(
    () => (media ? speechSegments(media.channels, media.sampleRate, media.audioStart, videoTools?.cut ?? "off", words) : []),
    [media, videoTools?.cut, words],
  );
  const cutting = (videoTools?.cut ?? "off") !== "off";
  const look = useMemo<Look>(
    () => ({
      format: videoTools?.format ?? "original",
      fit: videoTools?.fit ?? "blur",
      watermark: videoTools?.watermark ?? false,
      captions: captionState?.burnIn ? captionRender : null,
      fontFamily: captionRender?.fontFamily ?? (typeof window === "undefined" ? "sans-serif" : captionFontFamily()),
    }),
    [videoTools, captionState?.burnIn, captionRender],
  );

  const styleSettings: StyleSettings = {
    presetSlug: preset?.slug,
    intensity,
    noise,
    social,
    captionStyle: captionState?.style,
    captionPosition: captionState?.position,
    format: videoTools?.format,
    fit: videoTools?.fit,
    cutSilence: videoTools?.cut,
    watermark: videoTools?.watermark,
  };

  function applyStyle(st: StyleSettings) {
    const p = [...(catalog?.presets ?? []), ...userPresets].find((x) => x.slug === st.presetSlug);
    if (p) choosePreset(p);
    if (st.intensity && [25, 50, 75, 100].includes(st.intensity)) setIntensity(st.intensity as Intensity);
    if (st.noise) setNoise(st.noise);
    if (typeof st.social === "boolean") setSocial(st.social);
    if (st.captionStyle && st.captionPosition) {
      const style = st.captionStyle as CaptionStyleId;
      const position = st.captionPosition as CaptionPosition;
      setCaptionPrefs({ style, position });
      setCaptionState((c) => (c ? { ...c, style, position, captions: buildCaptions(allWords(c.captions), style) } : c));
    }
    setVideoTools((v) =>
      v
        ? {
            ...v,
            format: media?.kind === "audio" && st.format === "original" ? v.format : ((st.format as VideoToolsState["format"]) ?? v.format),
            fit: (st.fit as VideoToolsState["fit"]) ?? v.fit,
            cut: (st.cutSilence as VideoToolsState["cut"]) ?? v.cut,
            watermark: st.watermark ?? v.watermark,
          }
        : v,
    );
    toast.success("Estilo aplicado.");
  }

  const onToggleFavorite = useCallback(
    (p: StudioPreset) => {
      toggleFavorite(p.id).catch((err) => {
        if (err instanceof NeedLoginError) void requireLogin("Entre para salvar seus presets favoritos na sua conta.");
        else toast.error("Não foi possível salvar o favorito.");
      });
    },
    [toggleFavorite, toast, requireLogin],
  );

  function startCustomizing() {
    if (!preset || !chain) return;
    // parte exatamente do que a pessoa está ouvindo (intensidade e ajustes da bateria incluídos)
    setCustom({ presetId: preset.id, chain: freezeChain(chain, dspIntensity) });
    setDrumTweaks(null);
  }

  async function saveCustom(name: string): Promise<boolean> {
    if (!preset || !chain) return false;
    if (!(await requireLogin("Entre para salvar seus presets na sua conta e usar em qualquer aparelho."))) return false;
    try {
      const saved = await saveUserPreset({
        name,
        categoryId: preset.categoryId,
        // preset do usuário herda a base; preset compartilhado por link não tem base no catálogo
        basePresetId: preset.userPresetId ? (preset.basePresetId ?? null) : preset.id.startsWith("s-") ? null : preset.id,
        chain: freezeChain(chain, dspIntensity),
      });
      setUserPresets((list) => [...list.filter((p) => p.id !== saved.id), saved]);
      choosePreset(saved);
      track("preset_saved", { base: preset.slug });
      toast.success(`“${saved.name}” salvo em Meus presets.`);
      return true;
    } catch (err) {
      toast.error(err instanceof PresetLimitError ? "Você chegou ao limite de 50 presets. Apague algum para salvar outro." : "Não foi possível salvar o preset.");
      return false;
    }
  }

  const onDeleteUserPreset = useCallback(
    async (p: StudioPreset) => {
      if (!p.userPresetId || !confirm(`Apagar o preset “${p.name}”?`)) return;
      try {
        await deleteUserPreset(p.userPresetId);
        setUserPresets((list) => list.filter((x) => x.id !== p.id));
        if (chosenPreset?.id === p.id) setPreset(null);
      } catch {
        toast.error("Não foi possível apagar o preset.");
      }
    },
    [chosenPreset, toast],
  );

  /** Link público do preset: quem abre ouve no próprio vídeo (e conta como indicação). */
  const onShareUserPreset = useCallback(
    async (p: StudioPreset) => {
      if (!p.userPresetId) return;
      try {
        const code = await shareUserPreset(p.userPresetId);
        const url = `${window.location.origin}/p/${code}`;
        const text = `Montei esse timbre no Mix Pro: “${p.name}”. Testa no seu vídeo:`;
        track("preset_shared", { preset: p.slug });
        if (navigator.share) {
          await navigator.share({ title: p.name, text, url }).catch(() => {});
        } else {
          await navigator.clipboard.writeText(`${text} ${url}`);
          toast.success("Link copiado. Mande para quem quiser.");
        }
      } catch {
        toast.error("Não foi possível criar o link. A migração 20261001000005 já foi rodada?");
      }
    },
    [toast],
  );

  /** Samples e IRs escolhidos, carregados na taxa de outro arquivo (aplicar em vários vídeos). */
  async function assetsAt(sampleRate: number) {
    const drums = drumEff && drumLibrary ? await loadSampleSet(drumEff.samples, drumLibrary, sampleRate) : undefined;
    const known = irList ? irIds.filter((id) => irList.some((x) => x.id === id)) : [];
    const irs = known.length
      ? Object.fromEntries(await Promise.all(known.map(async (id) => [id, await loadIR(irList!.find((x) => x.id === id)!, sampleRate)] as const)))
      : undefined;
    return { drumSamples: drums, impulses: irs };
  }

  /** Kit premium: desbloqueia com créditos (uma vez só) antes de baixar. */
  async function unlockKits(kits: DrumKit[]): Promise<boolean> {
    if (!(await requireLogin("Entre na sua conta para desbloquear o kit e baixar."))) return false;
    const total = kits.reduce((s, k) => s + k.price_credits, 0);
    const names = kits.map((k) => `“${k.name}”`).join(" e ");
    if (!confirm(`Este som usa o kit premium ${names}. Desbloquear para sempre por ${total} ${total === 1 ? "crédito" : "créditos"}?`)) return false;
    try {
      for (const k of kits) {
        await unlockKit(k.id);
        track("kit_unlocked", { kit: k.name, price: k.price_credits });
      }
      setUnlocked((s) => new Set([...s, ...kits.map((k) => k.id)]));
      await refresh();
      toast.success(`Kit ${names} desbloqueado. É seu para sempre.`);
      return true;
    } catch (err) {
      if (String((err as Error).message ?? "").includes("INSUFFICIENT_CREDITS")) showNoCredits();
      else toast.error("Não foi possível desbloquear o kit.");
      return false;
    }
  }

  const pick = () => inputRef.current?.click();

  return (
    <>
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
        <section className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:items-start">
          <StudioTour />
          <div className="flex flex-col gap-4 lg:sticky lg:top-[calc(5rem+env(safe-area-inset-top))]">
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
              <ABPlayer
                original={original}
                processed={processed}
                busy={
                  previewBusy ??
                  (preset && !assetsReady ? "Baixando os sons do preset…" : !processed ? (preset ? "Preparando a prévia…" : "Escolha um preset") : null)
                }
                offsetSeconds={excerpt ? excerpt.start / media.sampleRate : 0}
                videoUrl={videoUrl}
                overlay={overlay}
              />
              {media.duration > 26 && media.duration <= 600 && (
                <label className="mt-3 flex cursor-pointer items-center gap-2 text-xs text-muted">
                  <input type="checkbox" checked={fullPreview} onChange={toggleFullPreview} className="size-4 accent-violet-500" />
                  Ouvir o arquivo inteiro na prévia ({formatDuration(media.duration)}) — demora um pouco mais para aplicar
                </label>
              )}
            </Card>
          </div>

          <div className="flex flex-col gap-4">
            <div className="sticky top-[calc(4rem+env(safe-area-inset-top))] z-30 -mx-4 bg-bg/90 px-4 py-2 backdrop-blur-xl md:static md:mx-0 md:bg-transparent md:p-0 md:backdrop-blur-none">
              <div className="grid grid-cols-4 gap-1 rounded-2xl border border-border bg-surface/60 p-1" role="tablist" aria-label="Ferramentas">
                {TABS.map(({ id, label, audioLabel, icon: Icon }) => (
                  <button
                    key={id}
                    role="tab"
                    aria-selected={tab === id}
                    onClick={() => setTab(id)}
                    className={cn(
                      "flex h-12 flex-col items-center justify-center gap-0.5 rounded-xl text-[11px] font-medium transition sm:h-11 sm:flex-row sm:gap-2 sm:text-sm",
                      tab === id ? "bg-brand text-white" : "text-muted hover:text-text",
                    )}
                  >
                    <Icon className="size-4" aria-hidden /> {media.kind === "audio" && audioLabel ? audioLabel : label}
                  </button>
                ))}
              </div>
            </div>

            <StyleBar current={styleSettings} onApply={applyStyle} />

            {tab === "som" && auto && (
              <AutoSetupCard
                setup={auto}
                applied={!chosenPreset && !chosenNoise}
                onReset={() => {
                  setPreset(null);
                  setCategoryId(null);
                  setNoise(null);
                  setIntensity(null);
                  setCustom(null);
                  setDrumTweaks(null);
                }}
              />
            )}

            {tab === "som" && (
              <>
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
                      userPresets={preset?.id.startsWith("s-") ? [preset, ...userPresets] : userPresets}
                      onDeleteUserPreset={onDeleteUserPreset}
                      onShareUserPreset={onShareUserPreset}
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
                {customizing ? (
                  <p className="px-1 text-xs text-muted">Personalizado: a intensidade fica exatamente como você ajustou abaixo.</p>
                ) : (
                  <Card className="p-4">
                    <IntensitySelector value={intensity} onChange={setIntensity} disabled={!preset} />
                  </Card>
                )}
                {drumBase && drumEff && (
                  <Card className="p-4">
                    <DrumPanel
                      media={media}
                      library={drumLibrary}
                      kits={drumKits}
                      unlocked={unlocked}
                      value={drumEff}
                      defaults={drumBase}
                      onChange={setDrumTweaks}
                      loading={Boolean(drumLibrary) && !drumReady}
                    />
                  </Card>
                )}
                {preset && (
                  <Card className="p-4">
                    <CustomizePanel
                      preset={preset}
                      chain={customizing ? baseChain : null}
                      onStart={startCustomizing}
                      onChange={(c) => setCustom({ presetId: preset.id, chain: c })}
                      onDiscard={() => setCustom(null)}
                      onSave={saveCustom}
                      irs={irList ?? []}
                    />
                  </Card>
                )}
                <Card className="p-4">
                  <NoiseSelector value={noise} onChange={setNoise} />
                </Card>
                <Card className="p-4">
                  <MusicPicker sampleRate={media.sampleRate} channels={media.channels.length} value={music} onChange={setMusic} />
                </Card>
                <Button variant="secondary" onClick={() => setTab("legendas")}>
                  Próximo: legendas
                </Button>
              </>
            )}

            {tab === "legendas" && (
              <>
                <Card className="p-4">
                  <h2 className="mb-3 font-display text-lg font-semibold">Legendas automáticas</h2>
                  <CaptionsPanel
                    media={media}
                    value={captionState}
                    onChange={setCaptionState}
                    defaults={captionPrefs}
                    mapTime={cutting ? (t) => mapToOutput(segments, t) : null}
                  />
                </Card>
                <Button variant="secondary" onClick={() => setTab("video")}>
                  Próximo: {media.kind === "video" ? "vídeo" : "edição"}
                </Button>
              </>
            )}

            {tab === "video" && videoTools && (
              <>
                <Card className="p-4">
                  <h2 className="mb-3 font-display text-lg font-semibold">{media.kind === "video" ? "Vídeo" : "Edição"}</h2>
                  <VideoTools
                    media={media}
                    videoUrl={videoUrl}
                    value={videoTools}
                    onChange={setVideoTools}
                    segments={segments}
                    hasWords={Boolean(words?.length)}
                    look={look}
                  />
                </Card>
                <Button variant="secondary" onClick={() => setTab("baixar")}>
                  Próximo: baixar
                </Button>
              </>
            )}

            {tab === "baixar" && (
              <Card className="p-4">
                <h2 className="mb-3 font-display text-lg font-semibold">Baixar</h2>
                <ExportPanel
                  media={media}
                  preset={preset}
                  chain={assetsReady ? chain : null}
                  drumSamples={drumSamples}
                  impulses={impulses}
                  lockedKits={lockedKits}
                  onUnlock={unlockKits}
                  assetsAt={assetsAt}
                  intensity={dspIntensity}
                  denoise={denoiseAmount}
                  segments={segments}
                  cutting={cutting}
                  look={look}
                  audiogram={media.kind === "audio" ? (videoTools?.audiogram ?? null) : null}
                  music={music}
                  words={words}
                  social={social}
                  onSocialChange={setSocial}
                  balance={account?.balance ?? null}
                  spend={spend}
                  onNeedCredits={showNoCredits}
                  signedIn={Boolean(user)}
                  requireLogin={requireLogin}
                />
              </Card>
            )}
          </div>
        </section>
      )}
    </>
  );
}
