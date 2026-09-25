"use client";

import { useState } from "react";
import Link from "next/link";
import { Download } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { useJob, jobIsActive } from "@/lib/hooks/use-job";
import { friendlyError } from "@/lib/errors";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { ProgressBar, Chip } from "@/components/ui/misc";
import { useToast } from "@/components/ui/toast";
import type { ProcessingJob } from "@/lib/types";

type Props = {
  trackId: string;
  presetVersionId: string | null;
  presetName: string | null;
  intensity: number;
  balance: number;
  onBalance: (b: number) => void;
  /** Aplica a seleção atual à faixa antes do download. */
  onBeforeDownload: () => Promise<void>;
  disabled?: boolean;
};

function triggerDownload(url: string) {
  const a = document.createElement("a");
  a.href = url;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export function DownloadPanel({ trackId, presetVersionId, presetName, intensity, balance, onBalance, onBeforeDownload, disabled }: Props) {
  const toast = useToast();
  const [format, setFormat] = useState<"wav" | "mp3">("wav");
  const [jobId, setJobId] = useState<string | null>(null);
  const [initial, setInitial] = useState<ProcessingJob | null>(null);
  const [confirm, setConfirm] = useState<{ fileId: string; alreadyPaid: boolean } | null>(null);
  const [authorizing, setAuthorizing] = useState(false);
  const job = useJob(jobId, initial, {
    // Render concluído → verifica se já foi pago e pede confirmação
    onSettled: async (j) => {
      setJobId(null);
      if (j.status === "failed") {
        toast.error(j.error_message ?? "Falha ao preparar o arquivo.");
        return;
      }
      if (j.status !== "completed" || !j.output_file_id) return;
      const { data } = await supabaseBrowser()
        .from("download_grants")
        .select("id")
        .eq("download_key", j.params.download_key ?? "")
        .maybeSingle();
      setConfirm({ fileId: j.output_file_id, alreadyPaid: !!data });
    },
  });

  async function prepare() {
    try {
      await onBeforeDownload();
      const { data, error } = await supabaseBrowser().rpc("enqueue_track_job", {
        p_track: trackId,
        p_type: "render",
        p_preset_version: presetVersionId,
        p_intensity: intensity,
        p_params: { format },
      });
      if (error) throw error;
      const j = data as ProcessingJob;
      setInitial(j);
      setJobId(j.id);
    } catch (e) {
      toast.error(friendlyError(e));
    }
  }

  async function authorize() {
    if (!confirm) return;
    setAuthorizing(true);
    const r = await fetch(`/api/downloads/${confirm.fileId}`, { method: "POST" });
    const body = await r.json();
    setAuthorizing(false);
    if (!r.ok) {
      toast.error(body.error ?? "Não foi possível baixar.");
      return;
    }
    onBalance(body.balance);
    setConfirm(null);
    triggerDownload(body.url);
    toast.success(body.charged ? "Download iniciado. 1 crédito utilizado." : "Download iniciado sem custo (você já baixou este resultado).");
  }

  const busy = jobIsActive(job) && job?.id === jobId;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">Baixar resultado</h3>
        <span className="text-xs text-muted">
          {balance} {balance === 1 ? "download disponível" : "downloads disponíveis"}
        </span>
      </div>
      <div className="flex gap-2" role="radiogroup" aria-label="Formato">
        <Chip active={format === "wav"} onClick={() => setFormat("wav")} role="radio" aria-checked={format === "wav"}>
          WAV (qualidade máxima)
        </Chip>
        <Chip active={format === "mp3"} onClick={() => setFormat("mp3")} role="radio" aria-checked={format === "mp3"}>
          MP3 320 kbps
        </Chip>
      </div>
      {busy ? (
        <div className="flex flex-col gap-2" aria-live="polite">
          <ProgressBar value={job?.progress ?? 0} label="Preparando download" />
          <p className="text-xs text-muted">{job?.status === "queued" ? "Na fila…" : (job?.stage ?? "Processando…")}</p>
        </div>
      ) : (
        <Button onClick={prepare} disabled={disabled} size="lg">
          <Download className="size-4" aria-hidden /> Baixar {format.toUpperCase()}
        </Button>
      )}
      <p className="text-[11px] text-subtle">
        O arquivo completo é processado com {presetName ? `${presetName} (${intensity}%)` : "o áudio original"}. Ouvir e testar não consome
        downloads.
      </p>

      <Modal open={!!confirm} onClose={() => setConfirm(null)} title="Confirmar download">
        {confirm && (
          <div className="flex flex-col gap-4">
            {confirm.alreadyPaid ? (
              <p className="text-sm text-muted">Você já baixou este resultado antes. Este download é gratuito.</p>
            ) : balance > 0 ? (
              <p className="text-sm text-muted">
                Este download usará <strong className="text-text">1</strong> dos seus <strong className="text-text">{balance}</strong>{" "}
                downloads disponíveis. Baixar o mesmo resultado novamente depois não terá custo.
              </p>
            ) : (
              <p className="text-sm text-muted">
                Você não tem downloads disponíveis. A compra de créditos estará disponível em breve.{" "}
                <Link href="/app/downloads" className="text-violet-300 underline">
                  Ver meus créditos
                </Link>
              </p>
            )}
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setConfirm(null)}>
                Cancelar
              </Button>
              <Button onClick={authorize} loading={authorizing} disabled={!confirm.alreadyPaid && balance <= 0}>
                Baixar agora
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
