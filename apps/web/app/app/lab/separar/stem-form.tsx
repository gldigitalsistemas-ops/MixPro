"use client";

import { useState } from "react";
import { Download, Loader2, Music2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useToast } from "@/components/ui/toast";
import { formatBytes } from "@/lib/cn";

type AudioFile = { id: string; original_name: string | null; kind: string; size_bytes: number | null; created_at: string };
type StemOutput = { stem_type: string; file_name: string; url: string };
type JobStatus = "idle" | "submitting" | "queued" | "processing" | "completed" | "failed";

const STEM_LABELS: Record<string, string> = {
  vocals: "Vocal", drums: "Bateria", bass: "Baixo",
  guitar: "Guitarra", piano: "Piano", other: "Outros",
};

export function StemSeparatorForm({ files }: { files: AudioFile[] }) {
  const toast = useToast();
  const [selectedFile, setSelectedFile] = useState<string>("");
  const [model, setModel] = useState<string>("htdemucs");
  const [stems, setStems] = useState<string>("4");
  const [jobStatus, setJobStatus] = useState<JobStatus>("idle");
  const [progress, setProgress] = useState(0);
  const [stage, setStage] = useState("");
  const [outputs, setOutputs] = useState<StemOutput[]>([]);
  const [errorMsg, setErrorMsg] = useState("");

  async function pollJob(jobId: string) {
    for (let attempt = 0; attempt < 120; attempt++) {
      await new Promise((r) => setTimeout(r, 3000));
      const res = await fetch(`/api/lab/jobs/${jobId}`);
      if (!res.ok) continue;
      const data = await res.json();
      setProgress(data.progress ?? 0);
      setStage(data.stage ?? "");
      if (data.status === "completed") {
        setJobStatus("completed");
        setOutputs(data.outputs ?? []);
        return;
      }
      if (data.status === "failed") {
        setJobStatus("failed");
        setErrorMsg(data.error_message ?? "Erro desconhecido.");
        return;
      }
      setJobStatus(data.status === "queued" ? "queued" : "processing");
    }
    setJobStatus("failed");
    setErrorMsg("Tempo limite excedido. Tente novamente.");
  }

  async function handleSubmit() {
    if (!selectedFile) return toast.error("Selecione um arquivo.");
    setJobStatus("submitting");
    setOutputs([]);
    setErrorMsg("");

    const res = await fetch("/api/lab/stem-separate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source_file_id: selectedFile, model, stems }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      setJobStatus("idle");
      return toast.error(err.error ?? "Erro ao iniciar separação.");
    }

    const { job_id } = await res.json();
    setJobStatus("queued");
    pollJob(job_id);
  }

  if (files.length === 0) {
    return (
      <Card className="flex flex-col items-center gap-4 p-8 text-center">
        <Music2 className="size-10 text-muted" aria-hidden />
        <p className="text-sm text-muted">Nenhum arquivo disponível. Suba um áudio em Novo Projeto primeiro.</p>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <Card className="flex flex-col gap-5 p-6">
        <label className="flex flex-col gap-1.5 text-sm">
          Arquivo de áudio
          <select
            value={selectedFile}
            onChange={(e) => setSelectedFile(e.target.value)}
            className="h-10 rounded-xl border border-border-strong bg-black/20 px-3 text-sm outline-none focus:border-violet-400"
            disabled={jobStatus !== "idle"}
          >
            <option value="">Selecione…</option>
            {files.map((f) => (
              <option key={f.id} value={f.id}>
                {f.original_name ?? f.id.slice(0, 8)} ({formatBytes(f.size_bytes ?? 0)}) · {f.kind}
              </option>
            ))}
          </select>
        </label>

        <div className="grid grid-cols-2 gap-4">
          <label className="flex flex-col gap-1.5 text-sm">
            Modelo
            <select
              value={model}
              onChange={(e) => setModel(e.target.value)}
              className="h-10 rounded-xl border border-border-strong bg-black/20 px-3 text-sm outline-none focus:border-violet-400"
              disabled={jobStatus !== "idle"}
            >
              <option value="htdemucs">htdemucs (recomendado)</option>
              <option value="mdx">MDX-Net</option>
              <option value="mdx_q">MDX-Net (rápido)</option>
            </select>
          </label>
          <label className="flex flex-col gap-1.5 text-sm">
            Stems
            <select
              value={stems}
              onChange={(e) => setStems(e.target.value)}
              className="h-10 rounded-xl border border-border-strong bg-black/20 px-3 text-sm outline-none focus:border-violet-400"
              disabled={jobStatus !== "idle"}
            >
              <option value="2">2 stems (vocal + instrumental)</option>
              <option value="4">4 stems (vocal, bateria, baixo, outro)</option>
              <option value="6">6 stems (+ guitarra, piano)</option>
            </select>
          </label>
        </div>

        <Button
          onClick={handleSubmit}
          disabled={!selectedFile || jobStatus !== "idle"}
          loading={jobStatus === "submitting"}
        >
          Separar stems
        </Button>
      </Card>

      {(jobStatus === "queued" || jobStatus === "processing") && (
        <Card className="flex flex-col gap-3 p-6">
          <div className="flex items-center gap-3">
            <Loader2 className="size-5 animate-spin text-violet-300" aria-hidden />
            <p className="text-sm">{stage || "Aguardando processamento…"}</p>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-white/8">
            <div className="bg-brand h-full rounded-full transition-all" style={{ width: `${progress}%` }} />
          </div>
          <p className="text-xs text-subtle">
            A separação de stems pode levar de 1 a 5 minutos dependendo da duração do áudio.
          </p>
        </Card>
      )}

      {jobStatus === "failed" && (
        <Card className="p-5">
          <p className="text-sm text-red-300">{errorMsg}</p>
          <button className="mt-2 text-xs text-violet-300 hover:text-violet-200" onClick={() => setJobStatus("idle")}>
            Tentar novamente
          </button>
        </Card>
      )}

      {jobStatus === "completed" && outputs.length > 0 && (
        <Card className="flex flex-col gap-4 p-6">
          <h2 className="font-medium">Stems prontos para download</h2>
          <div className="flex flex-col gap-2">
            {outputs.map((o) => (
              <a
                key={o.stem_type}
                href={o.url}
                download={o.file_name}
                className="flex items-center justify-between rounded-xl border border-border px-4 py-3 hover:bg-white/5"
              >
                <div className="flex items-center gap-3">
                  <Music2 className="size-4 text-violet-300" aria-hidden />
                  <span className="text-sm">{STEM_LABELS[o.stem_type] ?? o.stem_type}</span>
                </div>
                <Download className="size-4 text-muted" aria-hidden />
              </a>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
