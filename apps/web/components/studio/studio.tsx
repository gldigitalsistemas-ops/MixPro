"use client";

import { isFileGone, openPicker } from "@/lib/media/file-access";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AudioLines, FileAudio, FileVideo, RefreshCw, ShieldCheck } from "lucide-react";
import { ABPlayer, type ABSource } from "@/components/audio/ab-player";
import { IntensitySelector } from "@/components/presets/intensity";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ProgressBar } from "@/components/ui/misc";
import { useToast } from "@/components/ui/toast";
import { NeedLoginError } from "@/lib/account";
import { useAccountCtx } from "@/components/account/account-provider";
import { takeSharedFile } from "@/components/pwa/pwa";
import { cn, formatDuration, TIME_ZONE } from "@/lib/cn";
import { integratedLoudness, waveformPeaks } from "@/lib/dsp/loudness";
import { DspAbortError, runDsp } from "@/lib/dsp/runner";
import { pickExcerpt, toAudioBuffer, type Excerpt } from "@/lib/media/excerpt";
import { loadMedia, MediaLoadError, type LoadedMedia } from "@/lib/media/load";
import { fetchPresets, type StudioCategory, type StudioPreset } from "@/lib/presets";
import { DELIVERY_TARGETS, type DeliveryId, type Intensity } from "@mixpro/contracts";
import { ExportPanel } from "./export-panel";
import { StyleBar } from "./style-bar";
import { MusicPicker } from "./music-picker";
import { DrumPanel, drumDefaults, withDrumTweaks } from "./drum-panel";
import { mixMusic, safeCeiling } from "@/lib/media/music";
import { speechSegments } from "@/lib/media/cuts";
import type { Look } from "@/lib/media/compose";
import type { StyleSettings } from "@/lib/styles";
import { NOISE_AMOUNT, NoiseSelector, type NoiseLevel } from "./noise-selector";
import { PresetPicker } from "./preset-picker";
import { StudioTour } from "./tour";
import { CustomizePanel } from "./customize-panel";
import { clearSession, loadSession, saveSessionFile, saveSessionState, type SavedSession } from "@/lib/session-store";
import { beginTask, reportError, setErrorContext } from "@/lib/error-log";
import { InAppWarning } from "./in-app-warning";
import { supabaseBrowser } from "@/lib/supabase/client";
import { AmpTab } from "./amp-tab";
import { MasterPanel } from "./master-panel";
import {
  DEFAULT_TAB_ORDER,
  ampOf,
  isMasterCategory,
  isVirtualPreset,
  originalPreset,
  setAmp,
  starterPreset,
  tabOrder,
  withMaster,
  type AmpChoice,
  type Instrument,
  type SoundTab,
} from "@/lib/mix";
import { ReverbPanel } from "./reverb-panel";
import { reverbFromChain, withReverb } from "@/lib/reverb-tweak";
import type { ChainParts } from "@/lib/export/build-job";
import { editSnapshot, restorePatch } from "@/lib/edit-state";
import { useEditState } from "./use-edit-state";
import { AutoSetupCard } from "./auto-setup-card";
import { DiagnosisCard, type DiagnosisState } from "./diagnosis-card";
import { ResultSummary } from "./result-summary";
import { runDiagnosis } from "@/lib/dsp/diagnose-runner";
import { fetchServerExportEnabled, resetServerExportEnabled } from "@/lib/export/server-client";
import { analyzeAudio } from "@/lib/dsp/analyze";
import { autoSetup, instrumentCategories, instrumentOfCategory, pickPreset, type AutoSetup } from "@/lib/auto-setup";
import { track } from "@/lib/track";
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
const AUDIO_ACCEPT = "audio/*,.m4a,.mp3,.wav,.aac,.flac,.ogg";
const VIDEO_ACCEPT = "video/*,.mp4,.mov,.webm";

function UploadCard({ icon, title, text, onClick }: { icon: React.ReactNode; title: string; text: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="glass flex flex-col items-center gap-3 rounded-3xl border-2 border-dashed border-border-strong px-5 py-8 text-center transition hover:border-violet-400/60"
    >
      <span className="bg-brand grid size-14 place-items-center rounded-2xl text-white shadow-[0_8px_30px_-6px_rgb(124_58_237/0.7)]">{icon}</span>
      <span className="font-display text-lg font-semibold">{title}</span>
      <span className="text-xs text-muted">{text}</span>
    </button>
  );
}

function Steps() {
  const items = [
    ["1", "Envie o áudio ou o vídeo", "Da galeria ou do computador: celular, microfone ou interface."],
    ["2", "Ouça o antes e depois", "O Mix Pro analisa, escolhe o tratamento e você ajusta se quiser."],
    ["3", "Baixe pronto para publicar", "Áudio mixado e masterizado, ou o mesmo vídeo com o som novo."],
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

/** O vídeo é só o contêiner do áudio: a imagem sai exatamente como foi gravada. */
const PLAIN_LOOK: Look = { format: "original", fit: "blur", watermark: false, captions: null, fontFamily: "sans-serif", color: null, cta: null };

export function Studio() {
  const toast = useToast();
  const { user, account, favorites, spend, toggleFavorite, requireLogin, showNoCredits, refresh } = useAccountCtx();

  const [catalog, setCatalog] = useState<{ presets: StudioPreset[]; categories: StudioCategory[] } | null>(null);
  const [catalogError, setCatalogError] = useState(false);

  const [media, setMedia] = useState<LoadedMedia | null>(null);
  const [loading, setLoading] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const [categoryId, setCategoryId] = useState<string | null>(null);
  // estado da edição que define o arquivo final (som, legendas, vídeo, música)
  const {
    chosenPreset,
    setPreset,
    chosenIntensity,
    setIntensity,
    social,
    setSocial,
    delivery,
    setDelivery,
    chosenNoise,
    setNoise,
    music,
    setMusic,
    drumTweaks,
    setDrumTweaks,
    reverbTweak,
    setReverbTweak,
    masterId,
    setMasterId,
    custom,
    setCustom,
  } = useEditState();
  const [drumLibrary, setDrumLibrary] = useState<DrumLibraryItem[] | null>(null);
  const [drumSet, setDrumSet] = useState<{ key: string; set: DrumSampleSet } | null>(null);
  const [drumKits, setDrumKits] = useState<DrumKit[]>([]);
  const [unlockedList, setUnlocked] = useState<Set<string>>(new Set());
  const [irList, setIrList] = useState<CabIR[] | null>(null);
  const [irSet, setIrSet] = useState<{ key: string; map: Record<string, Float32Array> } | null>(null);
  // prévia do arquivo inteiro (em vez do melhor trecho de 20 s)
  const [fullPreview, setFullPreview] = useState(false);
  // ajuste automático: o que a análise encontrou no arquivo e o que ela escolheu
  // edição anterior salva no aparelho (ex.: o navegador fechou a página): oferece continuar
  const [resume, setResume] = useState<SavedSession | null>(null);
  const [auto, setAuto] = useState<AutoSetup | null>(null);
  const [diag, setDiag] = useState<DiagnosisState>(null);
  const [serverExport, setServerExport] = useState(false);
  const diagCtrl = useRef<AbortController | null>(null);
  /** Decisão sobre o ajuste automático: aceitar ou fazer a própria mixagem. */
  const [autoDecision, setAutoDecision] = useState<"aceito" | "manual" | null>(null);
  /** Ordem das abas de "Escolha o som" (definida no admin). */
  const [soundTabs, setSoundTabs] = useState<SoundTab[]>(DEFAULT_TAB_ORDER);
  const [userPresetList, setUserPresets] = useState<StudioPreset[]>([]);

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
  // servidor de exportação: só tenta quando está ligado para esta conta (senão, tudo no aparelho como sempre)
  useEffect(() => {
    resetServerExportEnabled();
    if (!user) return;
    let alive = true;
    void fetchServerExportEnabled().then((v) => alive && setServerExport(v));
    return () => {
      alive = false;
    };
  }, [user]);

  useEffect(() => {
    void loadCatalog();
    track("studio_open");
  }, [loadCatalog]);

  // ordem das abas de "Escolha o som" (o admin organiza)
  useEffect(() => {
    supabaseBrowser()
      .from("system_settings")
      .select("value")
      .eq("key", "studio_tabs")
      .maybeSingle()
      .then(
        ({ data }) => data && setSoundTabs(tabOrder(data.value)),
        () => {},
      );
  }, []);

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
    setReverbTweak(null);
    setCustom(null);
    // os setters do useEditState são os do useState (estáveis): listados só para o lint
  }, [setPreset, setIntensity, setDrumTweaks, setReverbTweak, setCustom]);

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
  const drumChain = useMemo(() => (baseChain ? withDrumTweaks(baseChain, drumEff) : null), [baseChain, drumEff]);
  // reverb: um controle só (Small/Médio/Large + quantidade) para todos os presets
  const reverbBase = useMemo(() => (drumChain ? reverbFromChain(drumChain) : null), [drumChain]);
  const reverbEff = reverbTweak ?? reverbBase;
  const mixChain = useMemo(() => (drumChain ? withReverb(drumChain, reverbTweak) : null), [drumChain, reverbTweak]);
  // masterização no fim (não vale para "Música pronta", que já é um master)
  const masters = useMemo(() => {
    const ids = new Set((catalog?.categories ?? []).filter((c) => c.groupId === "master").map((c) => c.id));
    return (catalog?.presets ?? []).filter((p) => ids.has(p.categoryId));
  }, [catalog]);
  const masterAllowed = !isMasterCategory(catalog?.categories.find((c) => c.id === preset?.categoryId));
  const masterPreset = masterAllowed ? (masters.find((m) => m.id === masterId) ?? null) : null;
  const chain = useMemo(() => (mixChain ? withMaster(mixChain, masterPreset) : null), [mixChain, masterPreset]);
  // as mesmas partes vão para a exportação (o ExportJob monta a cadeia com as mesmas funções)
  const chainParts = useMemo<ChainParts | null>(
    () => (baseChain ? { base: baseChain, drums: drumEff, reverb: reverbTweak, master: masterPreset } : null),
    [baseChain, drumEff, reverbTweak, masterPreset],
  );

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
    () => [...new Set((mixChain?.chain ?? []).filter((m) => m.type === "amp" && m.params?.ir).map((m) => String(m.params!.ir)))].sort(),
    [mixChain],
  );
  useEffect(() => {
    if (irList) return;
    fetchIRs()
      .then(setIrList)
      .catch(() => setIrList([]));
  }, [irList]);
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

  /** Volta as escolhas de uma edição salva no aparelho (depois que o arquivo é lido de novo). */
  function applyRestore(r: Record<string, unknown>) {
    const p = restorePatch(r);
    if ("preset" in p) setPreset(p.preset!);
    if ("categoryId" in p) setCategoryId(p.categoryId!);
    if ("intensity" in p) setIntensity(p.intensity as Intensity | null);
    if ("noise" in p) setNoise(p.noise as NoiseLevel | null);
    if ("social" in p) setSocial(p.social!);
    if ("delivery" in p && p.delivery) setDelivery(p.delivery as DeliveryId);
    if ("drumTweaks" in p) setDrumTweaks(p.drumTweaks!);
    if ("reverbTweak" in p) setReverbTweak(p.reverbTweak!);
    if ("custom" in p) setCustom(p.custom!);
    if ("masterId" in p) setMasterId(p.masterId!);
    if ("autoDecision" in p) setAutoDecision(p.autoDecision!);
    toast.success("Edição recuperada. Continue de onde parou.");
  }

  async function openFile(file: File, restore?: Record<string, unknown> | null) {
    setResume(null);
    // arquivo novo: a edição salva anterior deixa de valer
    if (!restore) void clearSession();
    const endTask = beginTask("abrir", "abrir o arquivo", { tamanho_mb: Math.round(file.size / 1e6), tipo: file.type || file.name.split(".").pop() });
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
    setMusic(null);
    setDrumTweaks(null);
    setReverbTweak(null);
    setCustom(null);
    setAutoDecision(null);
    setMasterId(null);
    setFullPreview(false);
    try {
      const m = await loadMedia(file, (p) => setLoading(p * 100));
      applyExcerpt(m, pickExcerpt(m.channels, m.sampleRate));
      let setup: AutoSetup | null = null;
      let found: ReturnType<typeof analyzeAudio> | null = null;
      try {
        found = analyzeAudio(m.channels, m.sampleRate);
        setup = autoSetup(found, m.kind);
      } catch {
        // análise é só uma ajuda: sem ela, valem os padrões
      }
      setAuto(setup);
      // diagnóstico (medidas reais) num Worker, sem travar a tela
      diagCtrl.current?.abort();
      const dc = new AbortController();
      diagCtrl.current = dc;
      setDiag({ status: "loading" });
      runDiagnosis(m.channels, m.sampleRate, { kind: found?.kind, instrument: found?.instrument?.type ?? null }, dc.signal)
        .then((diagnosis) => setDiag({ status: "ready", diagnosis }))
        .catch(() => {
          if (!dc.signal.aborted) setDiag({ status: "error" });
        });
      setMedia(m);
      if (restore) applyRestore(restore);
      track("file_loaded", { kind: m.kind, seconds: Math.round(m.duration), content: setup?.kind ?? "?" });
      setErrorContext({
        arquivo: m.kind,
        duracao_s: Math.round(m.duration),
        tamanho_mb: Math.round(file.size / 1e6),
        formato: file.type || file.name.split(".").pop(),
        taxa: m.sampleRate,
        canais: m.channels.length,
        conteudo: setup?.kind,
      });
      // guarda o arquivo no aparelho depois de aberto (gravar junto com a decodificação pesava no celular)
      if (!restore) {
        setTimeout(() => {
          void saveSessionFile(file).then((err) => err && reportError("salvar-edicao", err, { severity: "aviso", context: { tamanho_mb: Math.round(file.size / 1e6) } }));
        }, 1500);
      }
    } catch (err) {
      const userProblem = (err instanceof MediaLoadError && err.code !== "decode") || isFileGone(err);
      reportError("abrir-arquivo", err, {
        severity: userProblem ? "aviso" : "erro",
        context: { codigo: err instanceof MediaLoadError ? err.code : undefined, tamanho_mb: Math.round(file.size / 1e6), tipo: file.type || file.name.split(".").pop() },
      });
      toast.error(
        err instanceof MediaLoadError
          ? err.message
          : isFileGone(err)
            ? "O celular não liberou esse vídeo para leitura. Escolha de novo; se ele estiver no iCloud, espere baixar na Galeria antes."
            : "Não foi possível abrir esse arquivo.",
      );
    } finally {
      endTask();
      setLoading(null);
    }
  }

  // edição salva no aparelho a cada mudança (sem o áudio decodificado nem a música de fundo)
  useEffect(() => {
    if (!media || loading !== null) return;
    const t = setTimeout(() => {
      void saveSessionState(editSnapshot({
        preset: chosenPreset,
        categoryId,
        intensity: chosenIntensity,
        noise: chosenNoise,
        social,
        delivery,
        drumTweaks,
        reverbTweak,
        custom,
        masterId,
        autoDecision,
      }));
    }, 800);
    return () => clearTimeout(t);
  }, [media, loading, chosenPreset, categoryId, chosenIntensity, chosenNoise, social, delivery, drumTweaks, reverbTweak, custom, masterId, autoDecision]);

  useEffect(() => {
    if (window.location.search.includes("compartilhado=1")) return;
    loadSession()
      .then((sess) => sess && setResume(sess))
      .catch(() => {});
  }, []);

  // Prévia do trecho com o preset atual (cancela a anterior se o usuário trocar rápido)
  useEffect(() => {
    if (!media || !excerpt || !preset || !chain || !assetsReady) return;
    const ctrl = new AbortController();
    let endTask = () => {};
    const timer = setTimeout(() => {
      setPreviewBusy("Aplicando o preset…");
      endTask = beginTask("previa", "aplicar o preset na prévia", { preset: preset.slug });
      const from = excerpt.start - excerpt.preroll;
      runDsp(
        {
          channels: media.channels.map((c) => c.subarray(from, excerpt.end)),
          sampleRate: media.sampleRate,
          chain,
          intensity: dspIntensity,
          social,
          delivery: { targetLufs: DELIVERY_TARGETS[delivery].targetLufs, ceilingDb: DELIVERY_TARGETS[delivery].ceilingDb },
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
            key: `${preset.id}-${dspIntensity}-${social}-${delivery}-${denoiseAmount}-${music ? `${music.name}-${music.level}` : ""}-${JSON.stringify(chain)}`,
            buffer: toAudioBuffer(out, media.sampleRate),
            peaks: waveformPeaks(out),
            lufs: music ? integratedLoudness(out, media.sampleRate) : r.lufs,
          });
          setPreviewBusy(null);
        })
        .catch((err) => {
          if (err instanceof DspAbortError) return;
          setPreviewBusy(null);
          reportError("previa", err, { context: { preset: preset.slug } });
          toast.error("Não foi possível aplicar este preset. Tente outro.");
        })
        .finally(() => endTask());
    }, 150);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
      endTask();
    };
  }, [media, excerpt, preset, chain, dspIntensity, social, delivery, denoiseAmount, music, assetsReady, drumSamples, impulses]); // eslint-disable-line react-hooks/exhaustive-deps

  // o arquivo inteiro, sem cortes (o app só trata o som)
  const segments = useMemo(() => (media ? speechSegments(media.channels, media.sampleRate, media.audioStart, "off", null) : []), [media]);
  const look = PLAIN_LOOK;

  const styleSettings: StyleSettings = { presetSlug: preset?.slug, intensity, noise, social };

  function applyStyle(st: StyleSettings) {
    const p = [...(catalog?.presets ?? []), ...userPresets].find((x) => x.slug === st.presetSlug);
    if (p) choosePreset(p);
    if (st.intensity && [25, 50, 75, 100].includes(st.intensity)) setIntensity(st.intensity as Intensity);
    if (st.noise) setNoise(st.noise);
    if (typeof st.social === "boolean") setSocial(st.social);
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

  /** "Personalizar do zero": base com todos os módulos, já em edição. */
  function startFromScratch(kind: Instrument | "voz", catId: string) {
    const p = starterPreset(kind, catId || (preset?.categoryId ?? ""));
    choosePreset(p);
    // cópia: a edição precisa ser outro objeto para o editor abrir (igual ao preset = "não personalizando")
    setCustom({ presetId: p.id, chain: structuredClone(p.chain) });
    setAutoDecision((d) => d ?? "manual");
  }

  /** Amplificador e caixa escolhidos na aba Amplificadores, aplicados no som atual. */
  function applyAmp(choice: AmpChoice) {
    if (!preset || !mixChain) return;
    if (customizing && custom) setCustom({ presetId: preset.id, chain: setAmp(custom.chain, choice) });
    else {
      setCustom({ presetId: preset.id, chain: setAmp(freezeChain(mixChain, dspIntensity), choice) });
      setDrumTweaks(null);
      setReverbTweak(null);
    }
  }

  /** "Fazer minha mixagem": tira o ajuste automático e começa do som original. */
  function mixManually() {
    choosePreset(originalPreset(preset?.categoryId ?? "vocal-pop"));
    setNoise("off");
    setMasterId(null);
    setAutoDecision("manual");
  }

  function startCustomizing() {
    if (!preset || !chain) return;
    // parte exatamente do que a pessoa está ouvindo (intensidade e ajustes da bateria incluídos)
    setCustom({ presetId: preset.id, chain: freezeChain(mixChain ?? chain, dspIntensity) });
    setDrumTweaks(null);
    setReverbTweak(null);
  }

  async function saveCustom(name: string): Promise<boolean> {
    if (!preset || !chain) return false;
    if (!(await requireLogin("Entre para salvar seus presets na sua conta e usar em qualquer aparelho."))) return false;
    try {
      const saved = await saveUserPreset({
        name,
        categoryId: preset.categoryId,
        // preset do usuário herda a base; preset compartilhado por link não tem base no catálogo
        basePresetId: preset.userPresetId ? (preset.basePresetId ?? null) : isVirtualPreset(preset.id) ? null : preset.id,
        chain: freezeChain(mixChain ?? chain, dspIntensity),
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
    [chosenPreset, toast, setPreset],
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

  const pick = () => {
    if (inputRef.current) inputRef.current.accept = ACCEPT;
    openPicker(inputRef.current);
  };
  /** Seletor só de áudio ou só de vídeo (a galeria do celular já abre no tipo certo). */
  const pickOf = (accept: string) => {
    if (inputRef.current) inputRef.current.accept = accept;
    openPicker(inputRef.current);
  };

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        className="hidden"
        onChange={(e) => {
          // o campo só é limpo ao abrir o seletor: limpar aqui fazia o iPhone apagar a cópia
          // temporária do vídeo da Galeria antes da leitura ("NotFoundError")
          const f = e.target.files?.[0];
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

          <InAppWarning />

          {resume && loading === null && (
            <div className="mx-auto flex w-full max-w-2xl flex-col gap-3 rounded-3xl border border-violet-400/40 bg-primary/10 p-4 sm:flex-row sm:items-center">
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold">Continuar a edição de “{resume.file.name}”?</span>
                <span className="block text-xs text-muted">
                  Salva no seu aparelho em {new Date(resume.savedAt).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: TIME_ZONE })}: preset, legendas,
                  imagem, capa e post.
                </span>
              </span>
              <div className="flex gap-2">
                <Button size="sm" onClick={() => void openFile(resume.file, resume.state)}>
                  Continuar
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setResume(null);
                    void clearSession();
                  }}
                >
                  Descartar
                </Button>
              </div>
            </div>
          )}

          <div
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
            className={cn("mx-auto grid w-full max-w-3xl gap-3 rounded-3xl transition sm:grid-cols-3", dragOver && "bg-primary/10")}
          >
            {loading !== null ? (
              <div className="glass col-span-full flex flex-col items-center gap-3 rounded-3xl border-2 border-dashed border-violet-400 px-6 py-12">
                <p className="text-sm">Lendo o áudio do arquivo…</p>
                <ProgressBar value={loading} label="Lendo o arquivo" className="max-w-xs" />
              </div>
            ) : (
              <>
                <UploadCard
                  icon={<FileAudio className="size-7" />}
                  title="Enviar áudio"
                  text="Trate o som e baixe pronto. MP3, WAV, M4A."
                  onClick={() => pickOf(AUDIO_ACCEPT)}
                />
                <UploadCard
                  icon={<FileVideo className="size-7" />}
                  title="Enviar vídeo"
                  text="Troca só o som: a imagem continua igual. MP4, MOV."
                  onClick={() => pickOf(VIDEO_ACCEPT)}
                />
                <a
                  href="/vs"
                  className="glass flex flex-col items-center gap-3 rounded-3xl border-2 border-dashed border-border-strong px-5 py-8 text-center transition hover:border-violet-400/60"
                >
                  <span className="bg-brand grid size-14 place-items-center rounded-2xl text-white shadow-[0_8px_30px_-6px_rgb(124_58_237/0.7)]">
                    <AudioLines className="size-7" />
                  </span>
                  <span className="font-display text-lg font-semibold">Música para criar VS</span>
                  <span className="text-xs text-muted">Separa voz, bateria, baixo e instrumentos e cria o clique.</span>
                  <span className="rounded-full border border-amber-400/40 bg-amber-400/10 px-2.5 py-0.5 text-[11px] font-semibold text-amber-200">
                    Em desenvolvimento
                  </span>
                </a>
              </>
            )}
          </div>

          <p className="flex items-center justify-center gap-2 text-center text-xs text-muted">
            <ShieldCheck className="size-4 text-green-400" /> A imagem do vídeo nunca sai do seu aparelho. O áudio enviado para
            tratamento é apagado em até 24 horas.
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
              />
              {processed && (
                <div className="mt-3">
                  <ResultSummary original={original} processed={processed} kind={auto?.kind ?? null} delivery={delivery} volumeOn={social} />
                </div>
              )}
              {media.duration > 26 && media.duration <= 600 && (
                <label className="mt-3 flex cursor-pointer items-center gap-2 text-xs text-muted">
                  <input type="checkbox" checked={fullPreview} onChange={toggleFullPreview} className="size-4 accent-violet-500" />
                  Ouvir o arquivo inteiro na prévia ({formatDuration(media.duration)}) — demora um pouco mais para aplicar
                </label>
              )}
            </Card>
          </div>

          <div className="flex flex-col gap-4">
            <StyleBar current={styleSettings} onApply={applyStyle} />

            <DiagnosisCard state={diag} />

            {auto && (
              <AutoSetupCard
                setup={auto}
                applied={!chosenPreset && !chosenNoise}
                decision={autoDecision}
                onAccept={() => setAutoDecision("aceito")}
                onManual={mixManually}
                instrument={auto.instrument ? (instrumentOfCategory(preset?.categoryId) ?? auto.instrument) : null}
                onInstrument={(g) => {
                  const p = catalog ? pickPreset(catalog.presets, instrumentCategories(g)) : null;
                  if (p) choosePreset(p);
                  else toast.error("Ainda não há presets para essa escolha. Veja a aba Instrumentos.");
                }}
                onReset={() => {
                  setAutoDecision(null);
                  setPreset(null);
                  setCategoryId(null);
                  setNoise(null);
                  setIntensity(null);
                  setCustom(null);
                  setDrumTweaks(null);
                }}
              />
            )}

            {(
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
                      tabs={soundTabs}
                      onStartFromScratch={startFromScratch}
                      ampTab={<AmpTab value={ampOf(mixChain)} irs={irList} onChange={applyAmp} />}
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
                {reverbEff && reverbBase && (
                  <Card className="p-4">
                    <ReverbPanel value={reverbEff} defaults={reverbBase} onChange={setReverbTweak} />
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
                {masterAllowed && masters.length > 0 && (
                  <Card className="p-4">
                    <MasterPanel masters={masters} value={masterPreset?.id ?? null} onChange={setMasterId} />
                  </Card>
                )}
              </>
            )}

            {/* sempre montado (só escondido fora da aba): trocar de aba no meio da geração não perde o vídeo */}
            {(
              <Card className="p-4">
                <h2 className="mb-3 font-display text-lg font-semibold">Baixar</h2>
                <ExportPanel
                  serverExport={Boolean(user) && serverExport}
                  media={media}
                  preset={preset}
                  chainParts={assetsReady ? chainParts : null}
                  customizing={customizing}
                  library={{ drums: drumLibrary ?? [], irs: irList ?? [] }}
                  drumSamples={drumSamples}
                  impulses={impulses}
                  lockedKits={lockedKits}
                  onUnlock={unlockKits}
                  assetsAt={assetsAt}
                  intensity={dspIntensity}
                  denoise={denoiseAmount}
                  cutLevel="off"
                  segments={segments}
                  cutting={false}
                  look={look}
                  audiogram={null}
                  music={music}
                  words={null}
                  postText=""
                  social={social}
                  onSocialChange={setSocial}
                  delivery={delivery}
                  onDeliveryChange={setDelivery}
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
