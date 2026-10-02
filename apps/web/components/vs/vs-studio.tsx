"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Download, FileArchive, Headphones, Music2, Pause, Play, RotateCcw, Upload, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ProgressBar } from "@/components/ui/misc";
import { useToast } from "@/components/ui/toast";
import { useAccountCtx } from "@/components/account/account-provider";
import { NeedLoginError, NoCreditsError, OfflineError } from "@/lib/account";
import { cn, formatDuration } from "@/lib/cn";
import { isPhone } from "@/lib/device";
import { beginTask, reportError } from "@/lib/error-log";
import { MediaLoadError, loadMedia } from "@/lib/media/load";
import { exportAudio } from "@/lib/media/export";
import { resample } from "@/lib/dsp/resample";
import { track as trackEvent } from "@/lib/track";
import { keepAwake } from "@/lib/wake-lock";
import { SR, STEMS } from "@/lib/vs/demucs";
import { mixdown, wavBlob, zipBlob, type TrackData, type TrackMix } from "@/lib/vs/export";
import { VSPlayer } from "@/lib/vs/player";
import { SeparateAbort, separateStems, type SeparateProgress } from "@/lib/vs/separate";
import { clearVS, loadVS, peekVS, saveVS } from "@/lib/vs/store";
import { clickTrack, trackBeats, type Beats } from "@/lib/vs/tempo";

const PREVIEW_S = 20;
const MAX_MINUTES = 15;
/**
 * A IA de separação usa ~2,6 GB de memória por bloco (medido): o navegador do celular fecha a
 * página bem antes disso. No celular, só abrir VS já separados; separar, no computador.
 */
const canSeparateHere = () => {
  if (typeof navigator === "undefined") return true;
  if (isPhone()) return false;
  const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  return mem === undefined || mem >= 4;
};
const ISOLATION_FLAG = "mixpro.vs-isolation";

const LABELS: Record<string, string> = { vocals: "Voz", drums: "Bateria", bass: "Baixo", other: "Instrumentos", click: "Clique" };
const ORDER = ["vocals", "drums", "bass", "other", "click"];
const DEFAULT_MIX: TrackMix = { volume: 1, pan: 0, mute: false, solo: false };

type Phase =
  | { kind: "idle" }
  | { kind: "decoding"; progress: number }
  | { kind: "separating"; p: SeparateProgress; seconds: number; eta?: number }
  | { kind: "ready" };

function fnv(text: string): string {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return (h >>> 0).toString(36);
}

const baseName = (name: string) => name.replace(/\.[^.]+$/, "").slice(0, 60) || "musica";

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** Andamento pela metade, em dobro e mudança do tempo 1 (quando a detecção erra o compasso). */
function halfTime(b: Beats): Beats {
  return { bpm: Math.round(b.bpm * 5) / 10, beats: b.beats.filter((_, i) => i % 2 === b.downbeat % 2), downbeat: Math.floor(b.downbeat / 2) };
}
function doubleTime(b: Beats): Beats {
  const beats: number[] = [];
  b.beats.forEach((t, i) => {
    beats.push(t);
    if (i + 1 < b.beats.length) beats.push((t + b.beats[i + 1]) / 2);
  });
  return { bpm: Math.round(b.bpm * 20) / 10, beats, downbeat: b.downbeat * 2 };
}

export function VSStudio() {
  const toast = useToast();
  const { spend, requireLogin, showNoCredits } = useAccountCtx();
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [name, setName] = useState("");
  const [fileKey, setFileKey] = useState("");
  const [stems, setStems] = useState<Int16Array[][] | null>(null);
  const [beats, setBeats] = useState<Beats | null>(null);
  const [mix, setMix] = useState<Record<string, TrackMix>>(() => Object.fromEntries(ORDER.map((id) => [id, { ...DEFAULT_MIX }])));
  const [from, setFrom] = useState(0);
  const [paid, setPaid] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [saved, setSaved] = useState<{ name: string; savedAt: number } | null>(null);
  const [isolated] = useState(() => typeof window !== "undefined" && window.crossOriginIsolated);
  const canSeparate = useSyncExternalStore(
    () => () => {},
    canSeparateHere,
    () => true,
  );

  // várias threads só com a página isolada (cabeçalhos COOP/COEP desta rota): ao chegar por um
  // link interno, recarrega uma vez para ativar
  useEffect(() => {
    if (window.crossOriginIsolated) return;
    try {
      if (sessionStorage.getItem(ISOLATION_FLAG)) return;
      sessionStorage.setItem(ISOLATION_FLAG, "1");
      window.location.reload();
    } catch {}
  }, []);

  useEffect(() => {
    void peekVS().then(setSaved);
  }, []);

  const player = useMemo(() => new VSPlayer(), []);
  useEffect(() => () => player.dispose(), [player]);
  const playing = useSyncExternalStore(
    (cb) => player.subscribe(cb),
    () => player.playing,
    () => false,
  );
  const [now, setNow] = useState(0);
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    const tick = () => {
      setNow(player.currentTime());
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, player]);

  const length = stems?.[0][0].length ?? 0;
  const duration = length / SR;
  const click = useMemo(() => (beats && length ? clickTrack(beats, length, SR) : null), [beats, length]);
  const tracks = useMemo<TrackData[]>(() => {
    if (!stems || !click) return [];
    const byId: Record<string, TrackData> = Object.fromEntries(
      STEMS.map((s, i) => [s, { id: s, label: LABELS[s], left: stems[i][0], right: stems[i][1] }]),
    );
    byId.click = { id: "click", label: `${LABELS.click} (${beats?.bpm} BPM)`, left: click, right: click };
    return ORDER.map((id) => byId[id]);
  }, [stems, click, beats?.bpm]);

  // prévia: recarrega o trecho quando muda a música, o trecho ou o clique
  useEffect(() => {
    if (!tracks.length) return;
    player.load(tracks, SR, from, PREVIEW_S, mix);
  }, [tracks, from]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    player.setMix(mix);
  }, [mix, player]);

  const setTrack = (id: string, patch: Partial<TrackMix>) => setMix((m) => ({ ...m, [id]: { ...m[id], ...patch } }));
  const applyPreset = (p: "palco" | "playback" | "so-clique" | "tudo") =>
    setMix(() => {
      const m: Record<string, TrackMix> = Object.fromEntries(ORDER.map((id) => [id, { ...DEFAULT_MIX }]));
      if (p === "palco") {
        m.click.pan = -1;
        for (const id of ["vocals", "drums", "bass", "other"]) m[id].pan = 1;
      } else if (p === "playback") {
        m.vocals.mute = true;
      } else if (p === "so-clique") {
        m.click.solo = true;
      }
      if (p !== "palco" && p !== "so-clique") m.click.mute = true;
      return m;
    });

  async function open(file: File) {
    if (phase.kind === "decoding" || phase.kind === "separating") return;
    if (!canSeparateHere()) {
      toast.error("Para criar o VS, abra o Mix Pro no computador: o celular não tem memória para a IA de separação.");
      return;
    }
    player.pause();
    const endTask = beginTask("vs", "separar as pistas do VS", { tamanho_mb: Math.round(file.size / 1e6), tipo: file.type });
    const release = await keepAwake();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      setPhase({ kind: "decoding", progress: 0 });
      const media = await loadMedia(file, (p) => setPhase({ kind: "decoding", progress: p }));
      if (media.duration > MAX_MINUTES * 60) {
        throw new MediaLoadError("too_long", `A música tem mais de ${MAX_MINUTES} minutos. Corte um trecho e tente de novo.`);
      }
      const [l, r] = media.channels.length > 1 ? media.channels : [media.channels[0], media.channels[0]];
      const left = media.sampleRate === SR ? l.slice() : resample(l, media.sampleRate, SR);
      const right = media.sampleRate === SR ? (r === l ? left.slice() : r.slice()) : resample(r, media.sampleRate, SR);
      const seconds = left.length / SR;
      setPhase({ kind: "separating", p: { stage: "download", value: 0 }, seconds });
      // a bateria é calculada depois; uma cópia mono da música serve de reserva para o clique
      const mono = new Float32Array(left.length);
      for (let i = 0; i < mono.length; i++) mono[i] = (left[i] + right[i]) / 2;
      let sepStart = 0;
      const res = await separateStems(
        left,
        right,
        (p) => {
          if (p.stage === "separando" && !sepStart) sepStart = Date.now();
          // tempo que falta, pela média dos blocos já feitos
          const eta = p.stage === "separando" && p.done > 0 ? ((Date.now() - sepStart) / p.done) * (p.total - p.done) / 1000 : undefined;
          setPhase({ kind: "separating", p, seconds, eta });
        },
        ctrl.signal,
      );
      // batidas: pela bateria separada (mais limpa); sem bateria, pela música inteira
      const drums = res.stems[STEMS.indexOf("drums")];
      const dm = new Float32Array(drums[0].length);
      let energy = 0;
      for (let i = 0; i < dm.length; i++) {
        dm[i] = (drums[0][i] + drums[1][i]) / 65536;
        energy += dm[i] * dm[i];
      }
      const hasDrums = Math.sqrt(energy / Math.max(1, dm.length)) > 0.01;
      const b = trackBeats(hasDrums ? dm : mono, SR);
      const key = fnv(`${file.name}|${file.size}|${file.lastModified}`);
      setName(file.name);
      setFileKey(key);
      setStems(res.stems);
      setBeats(b);
      setFrom(Math.max(0, Math.min(seconds - PREVIEW_S, seconds * 0.3)));
      setPhase({ kind: "ready" });
      trackEvent("vs_separated", { seconds: Math.round(seconds), threads: res.threads, bpm: b.bpm });
      const err = await saveVS({ name: file.name, key, savedAt: Date.now(), sampleRate: SR, beats: b, stems: res.stems });
      if (err) reportError("vs-salvar", err, { severity: "aviso", context: { segundos: Math.round(seconds) } });
      else setSaved({ name: file.name, savedAt: Date.now() });
    } catch (err) {
      if (err instanceof SeparateAbort) {
        setPhase({ kind: "idle" });
        return;
      }
      const known = err instanceof MediaLoadError;
      reportError("vs", err, { severity: known ? "aviso" : "erro", context: { tamanho_mb: Math.round(file.size / 1e6) } });
      toast.error(known ? (err as Error).message : "Não foi possível separar esta música neste aparelho. Tente no computador ou com um trecho menor.");
      setPhase(stems ? { kind: "ready" } : { kind: "idle" });
    } finally {
      endTask();
      release();
      abortRef.current = null;
    }
  }

  async function restore() {
    const v = await loadVS();
    if (!v) return toast.error("A separação salva não está mais no aparelho.");
    setName(v.name);
    setFileKey(v.key);
    setStems(v.stems);
    setBeats(v.beats);
    const seconds = v.stems[0][0].length / SR;
    setFrom(Math.max(0, Math.min(seconds - PREVIEW_S, seconds * 0.3)));
    setPhase({ kind: "ready" });
  }

  /** 1 crédito por música separada; depois baixa à vontade (pistas, ZIP, mix). */
  const pay = useCallback(async (): Promise<boolean> => {
    if (paid === fileKey) return true;
    if (!(await requireLogin("Crie sua conta grátis para baixar as pistas. Separar e ouvir é grátis."))) return false;
    try {
      await spend(`vs_${fileKey.padStart(8, "0")}`, "audio");
      setPaid(fileKey);
      return true;
    } catch (err) {
      if (err instanceof NoCreditsError) showNoCredits();
      else if (err instanceof NeedLoginError) void requireLogin("Entre para baixar.");
      else if (err instanceof OfflineError) toast.error("Sem internet para registrar o download. Tente de novo quando a conexão voltar.");
      else {
        reportError("vs-credito", err);
        toast.error("Não foi possível registrar o download. Tente de novo.");
      }
      return false;
    }
  }, [paid, fileKey, requireLogin, spend, showNoCredits, toast]);

  async function download(kind: "zip" | "wav" | "mp3" | string) {
    if (busy || !tracks.length) return;
    if (!(await pay())) return;
    const release = await keepAwake();
    try {
      const base = baseName(name);
      if (kind === "zip") {
        setBusy("Juntando as pistas no ZIP…");
        const files = tracks.map((t) => ({ name: `${base} - ${t.label}.wav`, blob: wavBlob(t.left, t.right, SR) }));
        downloadBlob(await zipBlob(files), `${base} - pistas Mix Pro.zip`);
      } else if (kind === "wav" || kind === "mp3") {
        setBusy("Mixando em estéreo…");
        await new Promise((r) => setTimeout(r, 30));
        const m = mixdown(tracks, mix);
        if (kind === "wav") downloadBlob(wavBlob(m.left, m.right, SR), `${base} - VS Mix Pro.wav`);
        else {
          setBusy("Gerando o MP3…");
          const f = [Float32Array.from(m.left, (v) => v / 32768), Float32Array.from(m.right, (v) => v / 32768)];
          const media = { file: new File([], `${base} - VS.mp3`), sampleRate: SR } as Parameters<typeof exportAudio>[0];
          const out = await exportAudio(media, f, "mp3", () => {});
          downloadBlob(out.blob, `${base} - VS Mix Pro.mp3`);
        }
      } else {
        const t = tracks.find((x) => x.id === kind);
        if (t) downloadBlob(wavBlob(t.left, t.right, SR), `${base} - ${t.label}.wav`);
      }
      trackEvent("vs_download", { kind: ["zip", "wav", "mp3"].includes(kind) ? kind : "pista" });
    } catch (err) {
      reportError("vs-baixar", err, { context: { tipo: kind } });
      toast.error("Não foi possível gerar o arquivo. No celular, baixe as pistas uma a uma.");
    } finally {
      release();
      setBusy(null);
    }
  }

  const accept = "audio/*,video/*,.mp3,.wav,.m4a,.aac,.flac,.ogg,.mp4,.mov";

  // -------------------------------------------------------------- telas
  if (phase.kind === "decoding" || phase.kind === "separating") {
    const p = phase.kind === "separating" ? phase.p : null;
    const value =
      phase.kind === "decoding" ? phase.progress * 100 : p?.stage === "download" ? p.value * 100 : p?.stage === "separando" ? (p.done / p.total) * 100 : 0;
    const label =
      phase.kind === "decoding"
        ? "Lendo a música…"
        : p?.stage === "download"
          ? `Baixando a IA de separação (só na primeira vez, ~170 MB)… ${Math.round(value)}%`
          : p?.stage === "carregando"
            ? "Preparando a IA…"
            : `Separando voz, bateria, baixo e instrumentos… ${Math.round(value)}%`;
    const eta = phase.kind === "separating" && phase.eta !== undefined ? `Falta cerca de ${formatDuration(Math.max(1, phase.eta))}` : "";
    return (
      <Card className="mx-auto flex w-full max-w-xl flex-col gap-3 p-5" aria-live="polite">
        <h1 className="font-display text-xl font-semibold">Criando o seu VS</h1>
        <p className="text-sm">{label}</p>
        <ProgressBar value={value} label={label} />
        {eta && <p className="text-xs text-muted">{eta}</p>}
        <p className="text-xs text-subtle">
          Tudo acontece no seu aparelho. Mantenha esta tela aberta e não troque de app até terminar.
          {!isolated && " Este navegador está usando só um núcleo do processador: no Chrome ou Edge do computador fica bem mais rápido."}
        </p>
        <Button variant="secondary" size="sm" onClick={() => abortRef.current?.abort()} className="self-start">
          <X className="size-4" /> Cancelar
        </Button>
      </Card>
    );
  }

  if (phase.kind === "idle" || !stems || !beats) {
    return (
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-5">
        <input
          ref={inputRef}
          type="file"
          accept={accept}
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void open(f);
          }}
        />
        <div className="text-center">
          <h1 className="font-display text-3xl font-bold tracking-tight md:text-4xl">
            Crie seu <span className="text-gradient">VS</span> com IA
          </h1>
          <p className="mx-auto mt-2 max-w-lg text-muted">
            Envie uma música: a IA separa voz, bateria, baixo e instrumentos e cria o canal de clique no andamento da música. Você mixa,
            ouve e baixa as pistas para tocar ao vivo.
          </p>
        </div>
        {saved && (
          <div className="flex flex-col gap-3 rounded-3xl border border-violet-400/40 bg-primary/10 p-4 sm:flex-row sm:items-center">
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold">Abrir o VS de “{saved.name}”?</span>
              <span className="block text-xs text-muted">Já separado e salvo neste aparelho.</span>
            </span>
            <span className="flex gap-2">
              <Button size="sm" onClick={restore}>
                Abrir
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  void clearVS();
                  setSaved(null);
                }}
              >
                Apagar
              </Button>
            </span>
          </div>
        )}
        {!canSeparate ? (
          <div className="flex flex-col gap-3 rounded-3xl border border-amber-400/40 bg-amber-400/10 p-5 text-sm">
            <p className="font-semibold">Abra o Mix Pro no computador para criar o VS</p>
            <p className="text-muted">
              A IA que separa as pistas precisa de mais memória do que o navegador do celular libera (cerca de 3 GB): aqui a página
              fecharia no meio. No computador (Chrome ou Edge) funciona e leva mais ou menos 1,5× a duração da música.
            </p>
            <Button
              variant="secondary"
              size="sm"
              className="self-start"
              onClick={() => {
                void navigator.clipboard
                  ?.writeText(window.location.href)
                  .then(() => toast.success("Link copiado: abra no computador."), () => {});
              }}
            >
              Copiar o link
            </Button>
          </div>
        ) : (
        <button
          type="button"
          onClick={() => {
            if (inputRef.current) {
              inputRef.current.value = "";
              inputRef.current.click();
            }
          }}
          className="flex flex-col items-center gap-3 rounded-3xl border-2 border-dashed border-violet-400/50 p-8 text-center transition hover:bg-primary/10"
        >
          <span className="bg-brand grid size-14 place-items-center rounded-2xl text-white">
            <Upload className="size-6" />
          </span>
          <span className="font-semibold">Escolher música ou áudio</span>
          <span className="text-xs text-muted">MP3, WAV, M4A ou vídeo · até {MAX_MINUTES} minutos</span>
        </button>
        )}
        <ul className="grid gap-2 text-sm text-muted sm:grid-cols-2">
          <li>🎤 Voz, 🥁 bateria, 🎸 baixo e 🎹 instrumentos em pistas separadas</li>
          <li>⏱️ Clique gerado no andamento real da música</li>
          <li>🎚️ Mudo, solo, volume e pan de cada pista, ouvindo na hora</li>
          <li>⬇️ Pistas em WAV (ZIP) ou mix estéreo em WAV/MP3</li>
        </ul>
        <p className="text-center text-xs text-subtle">
          Separar e ouvir é grátis. Baixar usa 1 crédito por música (baixe quantas versões quiser). A separação roda no computador e leva
          cerca de 1,5× a duração da música; na primeira vez baixa a IA (~170 MB), que fica guardada.
        </p>
      </div>
    );
  }

  const anySolo = Object.values(mix).some((m) => m.solo);
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="truncate font-display text-xl font-semibold">{name}</h1>
          <p className="text-xs text-muted">
            {formatDuration(duration)} · {beats.bpm} BPM
          </p>
        </div>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => {
            player.pause();
            setPhase({ kind: "idle" });
          }}
        >
          <RotateCcw className="size-4" /> Outra música
        </Button>
      </div>

      <Card className="flex flex-col gap-3 p-4">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => player.toggle()}
            aria-label={playing ? "Pausar" : "Tocar"}
            className="bg-brand grid size-12 shrink-0 place-items-center rounded-full text-white"
          >
            {playing ? <Pause className="size-5" /> : <Play className="size-5" />}
          </button>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">Prévia de {PREVIEW_S} s</p>
            <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
              <div className="bg-brand h-full" style={{ width: `${(now / Math.max(0.01, player.duration)) * 100}%` }} />
            </div>
          </div>
        </div>
        <label className="flex flex-col gap-1 text-xs text-muted">
          Trecho da música: {formatDuration(from)} a {formatDuration(Math.min(duration, from + PREVIEW_S))}
          <input
            type="range"
            min={0}
            max={Math.max(0, duration - PREVIEW_S)}
            step={1}
            value={from}
            onChange={(e) => setFrom(Number(e.target.value))}
            aria-label="Trecho da prévia"
            className="accent-violet-500"
          />
        </label>
        <div className="flex flex-wrap gap-1.5">
          {(
            [
              ["tudo", "Tudo"],
              ["playback", "Sem voz (playback)"],
              ["palco", "Palco: clique à esquerda, banda à direita"],
              ["so-clique", "Só o clique"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => applyPreset(id)}
              className="rounded-full border border-border-strong px-3 py-1 text-xs text-muted hover:text-text"
            >
              {label}
            </button>
          ))}
        </div>
      </Card>

      <Card className="divide-y divide-border p-0">
        {tracks.map((t) => {
          const m = mix[t.id];
          const silent = m.mute || (anySolo && !m.solo);
          return (
            <div key={t.id} className={cn("flex flex-col gap-2 p-3 sm:flex-row sm:items-center", silent && "opacity-60")}>
              <div className="flex items-center gap-2 sm:w-44">
                <span className="min-w-0 flex-1 truncate text-sm font-semibold">{t.label}</span>
                <button
                  type="button"
                  aria-pressed={m.mute}
                  aria-label={`Mudo ${t.label}`}
                  onClick={() => setTrack(t.id, { mute: !m.mute })}
                  className={cn("size-8 rounded-lg text-xs font-bold", m.mute ? "bg-red-500/80 text-white" : "border border-border-strong text-muted")}
                >
                  M
                </button>
                <button
                  type="button"
                  aria-pressed={m.solo}
                  aria-label={`Solo ${t.label}`}
                  onClick={() => setTrack(t.id, { solo: !m.solo })}
                  className={cn("size-8 rounded-lg text-xs font-bold", m.solo ? "bg-amber-400 text-black" : "border border-border-strong text-muted")}
                >
                  S
                </button>
              </div>
              <label className="flex flex-1 items-center gap-2 text-xs text-muted">
                Vol
                <input
                  type="range"
                  min={0}
                  max={150}
                  value={Math.round(m.volume * 100)}
                  onChange={(e) => setTrack(t.id, { volume: Number(e.target.value) / 100 })}
                  aria-label={`Volume ${t.label}`}
                  className="flex-1 accent-violet-500"
                />
                <span className="w-9 text-right tabular-nums">{Math.round(m.volume * 100)}%</span>
              </label>
              <label className="flex items-center gap-2 text-xs text-muted sm:w-48">
                <span>E</span>
                <input
                  type="range"
                  min={-100}
                  max={100}
                  value={Math.round(m.pan * 100)}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    setTrack(t.id, { pan: Math.abs(v) < 6 ? 0 : v / 100 });
                  }}
                  aria-label={`Pan ${t.label}`}
                  className="flex-1 accent-violet-500"
                />
                <span>D</span>
              </label>
              <button
                type="button"
                onClick={() => download(t.id)}
                disabled={Boolean(busy)}
                aria-label={`Baixar ${t.label}`}
                className="self-start rounded-lg p-2 text-muted hover:bg-white/5 hover:text-text sm:self-center"
              >
                <Download className="size-4" />
              </button>
            </div>
          );
        })}
      </Card>

      <Card className="flex flex-col gap-2 p-4">
        <p className="text-sm font-medium">Clique: {beats.bpm} BPM</p>
        <p className="text-xs text-muted">Se o clique estiver no dobro ou na metade do andamento, ou o tempo forte no lugar errado, ajuste aqui:</p>
        <div className="flex flex-wrap gap-1.5">
          <Button size="sm" variant="secondary" onClick={() => setBeats(halfTime(beats))}>
            ½ andamento
          </Button>
          <Button size="sm" variant="secondary" onClick={() => setBeats(doubleTime(beats))}>
            2× andamento
          </Button>
          <Button size="sm" variant="secondary" onClick={() => setBeats({ ...beats, downbeat: (beats.downbeat + 1) % 4 })}>
            Mudar o tempo 1
          </Button>
        </div>
      </Card>

      <Card className="flex flex-col gap-3 p-4">
        <h2 className="font-display text-lg font-semibold">Baixar</h2>
        {busy ? (
          <p className="text-sm text-muted" aria-live="polite">
            {busy}
          </p>
        ) : (
          <div className="grid gap-2 sm:grid-cols-3">
            <Button onClick={() => download("zip")}>
              <FileArchive className="size-4" /> Todas as pistas (ZIP)
            </Button>
            <Button variant="secondary" onClick={() => download("wav")}>
              <Headphones className="size-4" /> Mix estéreo WAV
            </Button>
            <Button variant="secondary" onClick={() => download("mp3")}>
              <Music2 className="size-4" /> Mix estéreo MP3
            </Button>
          </div>
        )}
        <p className="text-xs text-subtle">
          {paid === fileKey
            ? "Crédito já usado para esta música: baixe quantas versões quiser."
            : "1 crédito por música: depois baixe as pistas e quantas mixagens quiser. O mix estéreo sai com o volume, o pan, o mudo e o solo que você ajustou."}
        </p>
      </Card>
    </div>
  );
}
