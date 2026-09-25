"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowLeft, AudioLines, Disc3, Drum, Guitar, Layers, Mic, Music2, Piano, Sparkles, SplitSquareHorizontal } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { uploadAudio, validateFile } from "@/lib/upload";
import { UploadDropzone } from "@/components/audio/upload-dropzone";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ProgressBar } from "@/components/ui/misc";
import { useToast } from "@/components/ui/toast";
import { AUDIO_TYPE_LABEL, DEFAULT_CATEGORY, type AudioType } from "@/lib/types";
import { cn, formatBytes } from "@/lib/cn";

const TYPES: { id: AudioType; icon: React.ElementType }[] = [
  { id: "vocal", icon: Mic },
  { id: "drums", icon: Drum },
  { id: "guitar", icon: Guitar },
  { id: "acoustic", icon: Guitar },
  { id: "piano", icon: Piano },
  { id: "bass", icon: Music2 },
  { id: "mix", icon: AudioLines },
  { id: "master", icon: Sparkles },
];

const MODES = [
  { id: "single", label: "Uma faixa", desc: "Um único arquivo de áudio.", icon: Disc3, available: true },
  { id: "stereo", label: "Estéreo L/R", desc: "Dois arquivos: esquerdo e direito.", icon: SplitSquareHorizontal, available: false },
  { id: "multitrack", label: "Várias pistas", desc: "Kick, caixa, overheads, voz…", icon: Layers, available: false },
] as const;

export function NewProjectWizard({ allowed, maxMb }: { allowed: string[]; maxMb: number }) {
  const router = useRouter();
  const toast = useToast();
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [type, setType] = useState<AudioType | null>(null);
  const [name, setName] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function start(f: File) {
    const invalid = validateFile(f, allowed, maxMb);
    if (invalid) return setError(invalid);
    setError(null);
    setFile(f);
    setProgress(0);
    const supabase = supabaseBrowser();
    try {
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) throw new Error("Sua sessão expirou. Entre novamente.");
      const projectName = name.trim() || f.name.replace(/\.[^.]+$/, "").slice(0, 120);
      const { data: project, error: pErr } = await supabase
        .from("projects")
        .insert({ user_id: auth.user.id, name: projectName, audio_type: type, mode: "single" })
        .select("id")
        .single();
      if (pErr || !project) throw new Error("Não foi possível criar o projeto.");
      const { data: track, error: tErr } = await supabase
        .from("tracks")
        .insert({
          project_id: project.id,
          user_id: auth.user.id,
          name: AUDIO_TYPE_LABEL[type!],
          category_id: DEFAULT_CATEGORY[type!],
        })
        .select("id")
        .single();
      if (tErr || !track) throw new Error("Não foi possível criar a faixa.");
      void supabase.from("analytics_events").insert({ user_id: auth.user.id, event: "project_created", props: { audio_type: type } });

      await uploadAudio(f, { project_id: project.id, track_id: track.id }, setProgress);
      router.push(`/app/projetos/${project.id}`);
    } catch (e) {
      setProgress(null);
      setFile(null);
      const msg = e instanceof Error ? e.message : "Falha no envio.";
      setError(msg);
      toast.error(msg);
    }
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <div className="flex items-center gap-3">
        {step > 1 && progress === null && (
          <button onClick={() => setStep((s) => (s - 1) as 1 | 2)} aria-label="Voltar" className="rounded-full p-2 text-muted hover:bg-white/5">
            <ArrowLeft className="size-5" />
          </button>
        )}
        <div>
          <p className="text-xs font-medium uppercase tracking-wider text-violet-300">Etapa {step} de 3</p>
          <h1 className="font-display text-2xl font-semibold">
            {step === 1 && "Que tipo de áudio você está trabalhando?"}
            {step === 2 && "Como você gravou?"}
            {step === 3 && "Envie seu áudio"}
          </h1>
        </div>
      </div>

      {step === 1 && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {TYPES.map(({ id, icon: Icon }) => (
            <button
              key={id}
              onClick={() => {
                setType(id);
                setStep(2);
              }}
              className={cn(
                "glass flex aspect-square flex-col items-center justify-center gap-3 rounded-2xl transition hover:border-violet-400/60 hover:bg-primary/10",
                type === id && "border-violet-400 bg-primary/15",
              )}
            >
              <Icon className="size-8 text-violet-300" aria-hidden />
              <span className="text-sm font-medium">{AUDIO_TYPE_LABEL[id]}</span>
            </button>
          ))}
        </div>
      )}

      {step === 2 && (
        <div className="flex flex-col gap-3">
          {MODES.map(({ id, label, desc, icon: Icon, available }) => (
            <button
              key={id}
              disabled={!available}
              onClick={() => setStep(3)}
              className="glass flex items-center gap-4 rounded-2xl p-5 text-left transition enabled:hover:border-violet-400/60 enabled:hover:bg-primary/10 disabled:opacity-50"
            >
              <span className="grid size-12 place-items-center rounded-xl bg-primary/15 text-violet-300">
                <Icon className="size-6" aria-hidden />
              </span>
              <span className="flex-1">
                <span className="flex items-center gap-2 font-medium">
                  {label} {!available && <Badge>Em breve</Badge>}
                </span>
                <span className="text-sm text-muted">{desc}</span>
              </span>
            </button>
          ))}
        </div>
      )}

      {step === 3 && (
        <Card className="flex flex-col gap-5 p-5 md:p-6">
          <label className="flex flex-col gap-1.5 text-sm">
            Nome do projeto <span className="text-xs text-subtle">(opcional — usamos o nome do arquivo)</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={120}
              disabled={progress !== null}
              placeholder="Ex.: Voz — Reels Instagram"
              className="h-12 rounded-xl border border-border-strong bg-black/20 px-4 outline-none focus:border-violet-400"
            />
          </label>

          {progress === null ? (
            <UploadDropzone onFile={start} allowed={allowed} maxMb={maxMb} />
          ) : (
            <div className="flex flex-col gap-3 rounded-2xl bg-black/20 p-5" aria-live="polite">
              <div className="flex justify-between text-sm">
                <span className="truncate font-medium">{file?.name}</span>
                <span className="text-muted">{formatBytes(file?.size)}</span>
              </div>
              <ProgressBar value={progress * 100} label="Progresso do envio" />
              <p className="text-xs text-muted">
                {progress < 1 ? `Enviando… ${Math.round(progress * 100)}%` : "Envio concluído. Preparando seu projeto…"}
              </p>
            </div>
          )}
          {error && (
            <p role="alert" className="text-sm text-red-300">
              {error}
            </p>
          )}
        </Card>
      )}
    </div>
  );
}
