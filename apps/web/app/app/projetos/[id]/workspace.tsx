"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Check, Info, MoreVertical, Pencil, RotateCcw, Trash2 } from "lucide-react";
import type { Intensity, PresetChain } from "@mixpro/contracts";
import { supabaseBrowser } from "@/lib/supabase/client";
import { useJob, jobIsActive } from "@/lib/hooks/use-job";
import { uploadAudio, validateFile } from "@/lib/upload";
import { friendlyError } from "@/lib/errors";
import { ABPlayer, type ABSource } from "@/components/audio/ab-player";
import { Waveform } from "@/components/audio/waveform";
import { UploadDropzone } from "@/components/audio/upload-dropzone";
import { useProcessorStatus } from "@/components/audio/processor-status";
import { PresetBrowser, type BrowserPreset } from "@/components/presets/preset-browser";
import { IntensitySelector } from "@/components/presets/intensity";
import { ChainView } from "@/components/presets/chain-view";
import { DownloadPanel } from "@/components/projects/download-panel";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Modal } from "@/components/ui/modal";
import { ProgressBar } from "@/components/ui/misc";
import { useToast } from "@/components/ui/toast";
import { AUDIO_TYPE_LABEL, WARNING_LABEL, type AnalysisStats, type AudioFile, type PresetCategory, type ProcessingJob, type Project, type Track } from "@/lib/types";
import { cn, formatBytes, formatDateTime, formatDuration } from "@/lib/cn";

export type WorkspacePreset = BrowserPreset & { version_id: string; chain: PresetChain };
export type HistoryJob = ProcessingJob & { preset_version: { version: number; preset: { name: string } | null } | null };

export type WorkspaceData = {
  project: Project;
  track: Track;
  source: AudioFile | null;
  analyzeJob: ProcessingJob | null;
  categories: PresetCategory[];
  presets: WorkspacePreset[];
  favorites: string[];
  history: HistoryJob[];
  balance: number;
  uploadLimits: { allowed: string[]; maxMb: number };
  isAdmin: boolean;
};

type Playable = ABSource & { duration_s: number | null; analysis: AnalysisStats | null };
type FilePayload = Playable & { pair: Playable | null };

const PREVIEW_S = 30;

export function Workspace({ data }: { data: WorkspaceData }) {
  const router = useRouter();
  const toast = useToast();
  const supabase = supabaseBrowser();
  const processor = useProcessorStatus(30000);

  const [project, setProject] = useState(data.project);
  const [source, setSource] = useState<AudioFile | null>(data.source);
  const [sourcePeaks, setSourcePeaks] = useState<number[] | null>(null);
  const [balance, setBalance] = useState(data.balance);
  const [favorites, setFavorites] = useState(() => new Set(data.favorites));
  const [history, setHistory] = useState(data.history);

  const presetByVersion = useMemo(() => new Map(data.presets.map((p) => [p.version_id, p])), [data.presets]);
  const [applied, setApplied] = useState({ versionId: data.track.preset_version_id, intensity: data.track.intensity as Intensity });
  const [selected, setSelected] = useState<WorkspacePreset | null>(
    data.track.preset_version_id ? (presetByVersion.get(data.track.preset_version_id) ?? null) : null,
  );
  const [intensity, setIntensity] = useState<Intensity>(data.track.intensity as Intensity);
  const [userSegStart, setSegStart] = useState<number | null>(null);
  const [proMode, setProMode] = useState(false);

  const [previewJobId, setPreviewJobId] = useState<string | null>(null);
  const [previewInitial, setPreviewInitial] = useState<ProcessingJob | null>(null);
  const [ab, setAb] = useState<{ original: Playable | null; processed: Playable | null }>({ original: null, processed: null });

  // ------------------------------------------------------------ análise do upload
  const analyzeJob = useJob(
    source && source.status !== "ready" && source.status !== "invalid" ? (data.analyzeJob?.id ?? null) : null,
    data.analyzeJob,
    {
      onSettled: async () => {
        const { data: t } = await supabase.from("tracks").select("source_file_id").eq("id", data.track.id).single();
        if (!t?.source_file_id) return;
        const { data: f } = await supabase.from("audio_files").select("*").eq("id", t.source_file_id).single();
        if (f) setSource(f as AudioFile);
      },
    },
  );

  const ready = source?.status === "ready";
  const duration = source?.duration_s ?? 0;
  const segStart = userSegStart ?? (ready ? (source?.analysis?.suggested_preview_start ?? 0) : null);

  useEffect(() => {
    if (!ready || !source) return;
    fetch(`/api/files/${source.id}`)
      .then((r) => r.json())
      .then((j) => setSourcePeaks(j.peaks ?? null))
      .catch(() => {});
  }, [ready, source?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // ------------------------------------------------------------ preview (A/B)
  const requestPreview = useCallback(async () => {
    if (!ready || segStart === null) return;
    const { data: job, error } = await supabase.rpc("enqueue_track_job", {
      p_track: data.track.id,
      p_type: "preview",
      p_preset_version: selected?.version_id ?? null,
      p_intensity: intensity,
      p_params: { start_s: segStart },
    });
    if (error) {
      toast.error(friendlyError(error));
      return;
    }
    const j = job as ProcessingJob;
    setPreviewInitial(j);
    setPreviewJobId(j.id);
    if (selected) {
      void supabase.from("analytics_events").insert({
        user_id: data.project.user_id,
        event: "preset_previewed",
        props: { preset_id: selected.id, intensity, cache_hit: j.cache_hit },
      });
    }
  }, [ready, segStart, selected, intensity, data.track.id, data.project.user_id, supabase, toast]);

  const debounce = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    clearTimeout(debounce.current);
    debounce.current = setTimeout(requestPreview, 250);
    return () => clearTimeout(debounce.current);
  }, [requestPreview]);

  const loadPreviewFiles = useCallback(
    (fileId: string) =>
      fetch(`/api/files/${fileId}`)
        .then(async (r) => {
          const body = await r.json();
          if (!r.ok) throw new Error(body.error);
          return body as FilePayload;
        })
        .then((f) => {
          if (f.pair) setAb({ original: f.pair, processed: f });
          else setAb({ original: f, processed: null });
        })
        .catch((e) => toast.error(e instanceof Error && e.message ? e.message : "Não foi possível carregar o preview.")),
    [toast],
  );

  const refreshHistory = useCallback(async () => {
    const { data: rows } = await supabase
      .from("processing_jobs")
      .select("*, preset_version:preset_versions(version, preset:presets!preset_versions_preset_id_fkey(name))")
      .eq("track_id", data.track.id)
      .in("type", ["preview", "render"])
      .order("created_at", { ascending: false })
      .limit(30);
    if (rows) setHistory(rows as HistoryJob[]);
  }, [data.track.id, supabase]);

  const previewJob = useJob(previewJobId, previewInitial, {
    onSettled: (job) => {
      if (job.status === "failed") toast.error(job.error_message ?? "Falha ao gerar o preview.");
      if (job.status === "completed" && job.output_file_id) {
        void loadPreviewFiles(job.output_file_id);
        void refreshHistory();
      }
    },
  });

  // ------------------------------------------------------------ ações
  const dirty = (selected?.version_id ?? null) !== applied.versionId || (selected && intensity !== applied.intensity);

  async function applyToTrack() {
    const { error } = await supabase
      .from("tracks")
      .update({ preset_version_id: selected?.version_id ?? null, intensity })
      .eq("id", data.track.id);
    if (error) throw error;
    setApplied({ versionId: selected?.version_id ?? null, intensity });
    if (selected) {
      void supabase.from("analytics_events").insert({
        user_id: data.project.user_id,
        event: "preset_applied",
        props: { preset_id: selected.id, intensity },
      });
    }
  }

  async function onApply() {
    try {
      await applyToTrack();
      toast.success(selected ? `${selected.name} aplicado ao projeto.` : "Projeto voltou ao áudio original.");
    } catch (e) {
      toast.error(friendlyError(e));
    }
  }

  function onDiscard() {
    setSelected(applied.versionId ? (presetByVersion.get(applied.versionId) ?? null) : null);
    setIntensity(applied.intensity);
  }

  async function toggleFavorite(presetId: string) {
    const next = new Set(favorites);
    if (next.has(presetId)) {
      next.delete(presetId);
      setFavorites(next);
      await supabase.from("favorites").delete().eq("preset_id", presetId);
    } else {
      next.add(presetId);
      setFavorites(next);
      await supabase.from("favorites").insert({ user_id: data.project.user_id, preset_id: presetId });
      void supabase.from("analytics_events").insert({ user_id: data.project.user_id, event: "favorite_created", props: { preset_id: presetId } });
    }
  }

  const busy = jobIsActive(previewJob) && previewJob?.id === previewJobId;
  const processedLabel = selected ? `${selected.name} · ${intensity}%` : "Processado";

  if (!source || source.status === "uploading" || source.status === "invalid") {
    return (
      <ReUpload project={project} track={data.track} source={source} limits={data.uploadLimits} onUploaded={() => router.refresh()} />
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <ProjectHeader project={project} onRename={setProject} />

      {processor && !processor.online && (
        <div role="status" className="flex items-start gap-3 rounded-2xl border border-warning/30 bg-warning/10 p-4 text-sm text-amber-200">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
          Processamento temporariamente indisponível. Seus pedidos ficam na fila e serão processados assim que o serviço voltar.
        </div>
      )}

      {!ready ? (
        <Card className="flex flex-col gap-3 p-6" aria-live="polite">
          <p className="font-medium">Analisando seu áudio…</p>
          <ProgressBar value={analyzeJob?.progress ?? 5} label="Análise do arquivo" />
          <p className="text-sm text-muted">
            {analyzeJob?.status === "queued" ? "Aguardando na fila…" : (analyzeJob?.stage ?? "Preparando…")}
          </p>
        </Card>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <div className="flex min-w-0 flex-col gap-6">
            <Card className="flex flex-col gap-3 p-5">
              <div className="flex items-center justify-between gap-3 text-sm">
                <div className="min-w-0">
                  <p className="truncate font-medium">{source.original_name}</p>
                  <p className="text-xs text-muted">
                    {formatDuration(duration)} · {source.sample_rate ? `${(source.sample_rate / 1000).toLocaleString("pt-BR")} kHz` : ""}
                    {source.bit_depth ? ` · ${source.bit_depth} bits` : ""} · {source.channels === 1 ? "Mono" : "Estéreo"} ·{" "}
                    {formatBytes(source.size_bytes)}
                  </p>
                </div>
                <Badge tone="info">{AUDIO_TYPE_LABEL[project.audio_type]}</Badge>
              </div>
              <Waveform
                peaks={sourcePeaks}
                height={56}
                variant="muted"
                selection={
                  duration > 0 && segStart !== null
                    ? { start: segStart / duration, end: Math.min(1, (segStart + PREVIEW_S) / duration) }
                    : null
                }
                onSeek={(f) => setSegStart(Math.max(0, Math.min(Math.round(f * duration * 10) / 10, Math.max(0, duration - PREVIEW_S))))}
                ariaLabel="Escolher trecho do preview"
              />
              <p className="text-xs text-subtle">
                Toque na forma de onda para escolher o trecho do preview ({PREVIEW_S}s a partir de {formatDuration(segStart ?? 0)}).
              </p>
              {source.warnings.length > 0 && (
                <ul className="flex flex-col gap-1.5">
                  {source.warnings.map((w) => (
                    <li key={w} className="flex items-start gap-2 text-xs text-amber-200">
                      <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                      {WARNING_LABEL[w] ?? w}
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            <Card className="flex flex-col gap-5 p-5">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 className="font-display text-lg font-semibold">Compare Original × {selected ? selected.name : "Processado"}</h2>
                  <p className="text-sm text-muted">
                    {selected ? "Alterne entre A e B sem perder a posição." : "Escolha um preset ao lado para ouvir a diferença."}
                  </p>
                </div>
              </div>
              <ABPlayer
                original={ab.original}
                processed={selected ? ab.processed : null}
                processedLabel={processedLabel}
                busy={busy}
                offsetSeconds={previewJob?.params.start_s ?? 0}
              />
              {busy && (
                <div className="flex flex-col gap-1.5" aria-live="polite">
                  <ProgressBar value={previewJob?.progress ?? 0} label="Progresso do preview" />
                  <p className="text-xs text-muted">{previewJob?.status === "queued" ? "Na fila…" : (previewJob?.stage ?? "Processando…")}</p>
                </div>
              )}
              {selected && ab.original?.analysis && ab.processed?.analysis && !busy && (
                <AnalysisCompare a={ab.original.analysis} b={ab.processed.analysis} />
              )}
            </Card>

            {selected && (
              <Card className="flex flex-col gap-4 p-5">
                <div className="flex items-center justify-between">
                  <h2 className="font-medium">O que este preset faz</h2>
                  <div className="flex rounded-full border border-border p-0.5 text-xs" role="group" aria-label="Modo de visualização">
                    {[false, true].map((pro) => (
                      <button
                        key={String(pro)}
                        aria-pressed={proMode === pro}
                        onClick={() => setProMode(pro)}
                        className={cn("rounded-full px-3 py-1", proMode === pro ? "bg-white/10 text-text" : "text-muted")}
                      >
                        {pro ? "Profissional" : "Simples"}
                      </button>
                    ))}
                  </div>
                </div>
                <ChainView chain={selected.chain} intensity={intensity} pro={proMode} />
              </Card>
            )}

            <History jobs={history} />
          </div>

          <div className="flex flex-col gap-6">
            <Card className="flex flex-col gap-4 p-5">
              <PresetBrowser
                presets={data.presets}
                categories={data.categories}
                initialCategory={data.track.category_id}
                favorites={favorites}
                selectedId={selected?.id ?? null}
                appliedId={applied.versionId ? (presetByVersion.get(applied.versionId)?.id ?? null) : null}
                onSelect={(p) => setSelected(p as WorkspacePreset)}
                onToggleFavorite={toggleFavorite}
              />
              <IntensitySelector value={intensity} onChange={setIntensity} disabled={!selected} />
              <div className="grid grid-cols-2 gap-2">
                <Button variant="secondary" onClick={onDiscard} disabled={!dirty}>
                  <RotateCcw className="size-4" aria-hidden /> Descartar
                </Button>
                <Button onClick={onApply} disabled={!dirty}>
                  <Check className="size-4" aria-hidden /> Aplicar
                </Button>
              </div>
              {selected && (
                <button onClick={() => setSelected(null)} className="text-xs text-muted underline-offset-2 hover:underline">
                  Ouvir só o original
                </button>
              )}
            </Card>

            <Card className="p-5">
              <DownloadPanel
                trackId={data.track.id}
                presetVersionId={selected?.version_id ?? null}
                presetName={selected?.name ?? null}
                intensity={intensity}
                balance={balance}
                onBalance={setBalance}
                onBeforeDownload={async () => {
                  if (dirty) await applyToTrack();
                }}
              />
            </Card>

            <Card className="p-5 text-sm">
              <p className="font-medium">Quer uma mixagem feita por um profissional?</p>
              <p className="mt-1 text-muted">
                Em breve você poderá enviar suas pistas e contratar uma mixagem personalizada aqui mesmo.
              </p>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
function ProjectHeader({ project, onRename }: { project: Project; onRename: (p: Project) => void }) {
  const router = useRouter();
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [menu, setMenu] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function rename(name: string) {
    setEditing(false);
    const clean = name.trim().slice(0, 120);
    if (!clean || clean === project.name) return;
    const { error } = await supabaseBrowser().from("projects").update({ name: clean }).eq("id", project.id);
    if (error) toast.error("Não foi possível renomear.");
    else onRename({ ...project, name: clean });
  }

  async function remove() {
    setDeleting(true);
    const { error } = await supabaseBrowser().rpc("delete_project", { p_project: project.id });
    setDeleting(false);
    if (error) return toast.error(friendlyError(error));
    toast.success("Projeto excluído.");
    router.push("/app/projetos");
    router.refresh();
  }

  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        {editing ? (
          <input
            autoFocus
            defaultValue={project.name}
            onBlur={(e) => rename(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && rename(e.currentTarget.value)}
            aria-label="Nome do projeto"
            className="w-full rounded-lg border border-violet-400 bg-black/20 px-2 font-display text-2xl font-semibold outline-none"
          />
        ) : (
          <button onClick={() => setEditing(true)} className="group flex items-center gap-2 text-left">
            <h1 className="truncate font-display text-2xl font-semibold md:text-3xl">{project.name}</h1>
            <Pencil className="size-4 text-subtle opacity-0 transition group-hover:opacity-100" aria-label="Renomear" />
          </button>
        )}
        <p className="text-sm text-muted">Criado em {formatDateTime(project.created_at)}</p>
      </div>
      <div className="relative">
        <button onClick={() => setMenu((m) => !m)} aria-label="Mais opções" aria-expanded={menu} className="rounded-full p-2 text-muted hover:bg-white/5">
          <MoreVertical className="size-5" />
        </button>
        {menu && (
          <div className="glass absolute right-0 z-20 mt-1 w-48 rounded-xl bg-surface p-1 shadow-xl">
            <button
              onClick={() => {
                setMenu(false);
                setConfirmDelete(true);
              }}
              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-red-300 hover:bg-danger/10"
            >
              <Trash2 className="size-4" aria-hidden /> Excluir projeto
            </button>
          </div>
        )}
      </div>
      <Modal open={confirmDelete} onClose={() => setConfirmDelete(false)} title="Excluir projeto?">
        <p className="text-sm text-muted">
          O projeto <strong className="text-text">{project.name}</strong>, o áudio enviado e todos os resultados serão apagados
          permanentemente. Downloads já feitos continuam no seu dispositivo.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setConfirmDelete(false)}>
            Cancelar
          </Button>
          <Button variant="danger" onClick={remove} loading={deleting}>
            Excluir
          </Button>
        </div>
      </Modal>
    </div>
  );
}

function AnalysisCompare({ a, b }: { a: AnalysisStats; b: AnalysisStats }) {
  const rows: [string, keyof AnalysisStats, string][] = [
    ["Loudness", "lufs_integrated", "LUFS"],
    ["Pico", "peak_dbfs", "dBFS"],
    ["True peak", "true_peak_dbtp", "dBTP"],
    ["Dinâmica (PLR)", "dynamic_range_db", "dB"],
  ];
  const f = (v: unknown) => (typeof v === "number" ? v.toLocaleString("pt-BR", { maximumFractionDigits: 1 }) : "—");
  return (
    <div className="rounded-2xl border border-border p-3">
      <table className="w-full text-xs">
        <caption className="mb-2 text-left text-subtle">Análise do trecho (informativa — não existe valor “certo”)</caption>
        <thead>
          <tr className="text-subtle">
            <th className="text-left font-normal" />
            <th className="text-right font-normal">A · Original</th>
            <th className="text-right font-normal">B · Processado</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([label, key, unit]) => (
            <tr key={key}>
              <th scope="row" className="py-0.5 text-left font-normal text-muted">
                {label}
              </th>
              <td className="text-right tabular-nums">
                {f(a[key])} <span className="text-subtle">{unit}</span>
              </td>
              <td className="text-right tabular-nums text-violet-200">
                {f(b[key])} <span className="text-subtle">{unit}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function History({ jobs }: { jobs: HistoryJob[] }) {
  const items = jobs.filter((j) => j.status === "completed" && j.preset_version).slice(0, 12);
  if (items.length === 0) return null;
  return (
    <Card className="p-5">
      <h2 className="mb-3 font-medium">Histórico</h2>
      <ol className="flex flex-col gap-2 text-sm">
        {items.map((j) => (
          <li key={j.id} className="flex items-center justify-between gap-3">
            <span className="flex min-w-0 items-center gap-3">
              <span className="w-24 shrink-0 text-xs tabular-nums text-subtle">{formatDateTime(j.created_at)}</span>
              <span className="truncate">
                {j.preset_version?.preset?.name ?? "Preset"} <span className="text-muted">· {j.intensity}%</span>
              </span>
            </span>
            <Badge tone={j.type === "render" ? "success" : "neutral"}>{j.type === "render" ? "Exportado" : "Preview"}</Badge>
          </li>
        ))}
      </ol>
    </Card>
  );
}

function ReUpload({
  project,
  track,
  source,
  limits,
  onUploaded,
}: {
  project: Project;
  track: Track;
  source: AudioFile | null;
  limits: { allowed: string[]; maxMb: number };
  onUploaded: () => void;
}) {
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <h1 className="font-display text-2xl font-semibold">{project.name}</h1>
      {source?.status === "invalid" && (
        <div role="alert" className="flex items-start gap-3 rounded-2xl border border-danger/30 bg-danger/10 p-4 text-sm text-red-200">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
          <div>
            <p className="font-medium">Não conseguimos usar este arquivo</p>
            <p>{source.error_message ?? "O arquivo é inválido."} Envie outro arquivo.</p>
          </div>
        </div>
      )}
      <Card className="p-5">
        {progress === null ? (
          <UploadDropzone
            allowed={limits.allowed}
            maxMb={limits.maxMb}
            onFile={async (f) => {
              const invalid = validateFile(f, limits.allowed, limits.maxMb);
              if (invalid) return setError(invalid);
              setError(null);
              setProgress(0);
              try {
                await uploadAudio(f, { project_id: project.id, track_id: track.id }, setProgress);
                onUploaded();
              } catch (e) {
                setProgress(null);
                setError(e instanceof Error ? e.message : "Falha no envio.");
              }
            }}
          />
        ) : (
          <ProgressBar value={progress * 100} label="Progresso do envio" />
        )}
        {error && <p className="mt-3 text-sm text-red-300">{error}</p>}
      </Card>
    </div>
  );
}
