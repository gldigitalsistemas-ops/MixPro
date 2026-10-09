"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { AudioLines, Download, Film, Loader2, XCircle } from "lucide-react";
import { useAccountCtx } from "@/components/account/account-provider";
import { Badge, type Tone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ProgressBar } from "@/components/ui/misc";
import { useToast } from "@/components/ui/toast";
import { exportErrorInfo } from "@/lib/export/error-messages";
import { supabaseBrowser } from "@/lib/supabase/client";
import { formatDateTime, formatDuration } from "@/lib/cn";
import { ToolJobsList } from "./tool-jobs";

type Row = {
  id: string;
  status: "queued" | "running" | "done" | "failed" | "expired";
  progress: number;
  kind: "audio" | "video";
  target: "wav" | "mp3" | "m4a" | "video";
  error_code: string | null;
  duration_s: number | null;
  lufs: number | null;
  created_at: string;
  expires_at: string;
};

const TARGET: Record<Row["target"], string> = {
  wav: "WAV",
  mp3: "MP3",
  m4a: "M4A",
  video: "Vídeo com o áudio tratado",
};

type DeviceRow = { id: string; target: Row["target"]; created_at: string };

/**
 * Download registrado sem job do servidor por perto (2 min) = processado no aparelho. O formato vem do fim da
 * referência do resultado (…_mp3, …_wav, …_m4a, …_video).
 */
function deviceRows(txs: { id: string; reference_id: string | null; created_at: string }[], jobs: Row[]): DeviceRow[] {
  const done = jobs.filter((j) => j.status === "done").map((j) => ({ t: new Date(j.created_at).getTime(), target: j.target }));
  return txs.flatMap((tx) => {
    const target = (tx.reference_id?.match(/_(mp3|wav|m4a|video)$/)?.[1] ?? null) as Row["target"] | null;
    if (!target) return [];
    const at = new Date(tx.created_at).getTime();
    const fromServer = done.some((j) => j.target === target && at >= j.t - 60_000 && at - j.t <= 30 * 60_000);
    return fromServer ? [] : [{ id: tx.id, target, created_at: tx.created_at }];
  });
}

function statusOf(r: Row, now: number): { label: string; tone: Tone } {
  if (r.status === "queued") return { label: "Na fila", tone: "info" };
  if (r.status === "running") return { label: "Processando", tone: "primary" };
  if (r.status === "done")
    return new Date(r.expires_at).getTime() > now ? { label: "Concluído", tone: "success" } : { label: "Arquivo expirado", tone: "neutral" };
  if (r.status === "expired") return { label: "Arquivo expirado", tone: "neutral" };
  return r.error_code === "CANCELLED" ? { label: "Cancelado", tone: "neutral" } : { label: "Não concluído", tone: "danger" };
}

/**
 * Meus projetos: o que foi processado no servidor (arquivos por 24 horas; depois só o registro) e o que
 * foi processado no próprio aparelho (vem dos downloads registrados; o arquivo fica só no aparelho).
 */
export function ProjectsView() {
  const { user, requireLogin } = useAccountCtx();
  const toast = useToast();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  /** O "agora" da última atualização da lista (valor puro durante a renderização). */
  const [now, setNow] = useState(0);
  /** Downloads feitos no aparelho (sem job no servidor). */
  const [device, setDevice] = useState<DeviceRow[]>([]);

  const load = useCallback(async () => {
    const { data, error } = await supabaseBrowser()
      .from("my_export_jobs")
      .select("id,status,progress,kind,target,error_code,duration_s,lufs,created_at,expires_at")
      .order("created_at", { ascending: false })
      .limit(50);
    if (!error) {
      const jobs = (data ?? []) as Row[];
      const { data: txs } = await supabaseBrowser()
        .from("credit_transactions")
        .select("id,reference_id,created_at")
        .eq("type", "DOWNLOAD")
        .eq("reference_type", "export")
        .order("created_at", { ascending: false })
        .limit(50);
      setRows(jobs);
      setDevice(
        deviceRows(
          (txs ?? []) as {
            id: string;
            reference_id: string | null;
            created_at: string;
          }[],
          jobs,
        ),
      );
      setNow(Date.now());
    }
  }, []);

  useEffect(() => {
    // o carregamento inicial é uma chamada de rede; o estado só muda quando ela responde
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (user) void load();
  }, [user, load]);

  const active = rows?.some((r) => r.status === "queued" || r.status === "running") ?? false;
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => void load(), 4000);
    return () => clearInterval(t);
  }, [active, load]);

  async function download(r: Row) {
    setBusyId(r.id);
    try {
      const res = await fetch(`/api/export/jobs/${r.id}`, {
        cache: "no-store",
      });
      const body = (await res.json().catch(() => null)) as {
        download_url?: string | null;
        error?: string;
      } | null;
      if (!res.ok || !body?.download_url) throw new Error(body?.error);
      const a = document.createElement("a");
      a.href = body.download_url;
      a.download = "";
      a.rel = "noopener";
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch {
      toast.error("Não foi possível baixar agora. O arquivo pode ter expirado: processe de novo no Estúdio.");
    } finally {
      setBusyId(null);
    }
  }

  async function cancel(r: Row) {
    setBusyId(r.id);
    try {
      const res = await fetch(`/api/export/jobs/${r.id}/cancel`, {
        method: "POST",
      });
      if (!res.ok) throw new Error();
      toast.success("Processamento cancelado. Nenhum crédito foi usado.");
      await load();
    } catch {
      toast.error("Não foi possível cancelar agora.");
    } finally {
      setBusyId(null);
    }
  }

  if (!user)
    return (
      <Card className="flex flex-col items-start gap-3 p-6">
        <h1 className="font-display text-2xl font-semibold">Meus projetos</h1>
        <p className="text-sm text-muted">Entre na sua conta para ver o que você processou.</p>
        <Button onClick={() => void requireLogin("Entre para ver seus projetos.")}>Entrar</Button>
      </Card>
    );

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="font-display text-2xl font-semibold">Meus projetos</h1>
        <p className="text-sm text-muted">Seus áudios e vídeos tratados. Os processados no servidor ficam disponíveis para baixar de novo por 24 horas (30 dias no Plano Pro).</p>
      </div>

      <ToolJobsList />

      {rows === null ? (
        <p className="flex items-center gap-2 text-sm text-muted">
          <Loader2 className="size-4 animate-spin" aria-hidden /> Carregando…
        </p>
      ) : rows.length === 0 && device.length === 0 ? (
        <Card className="flex flex-col items-start gap-3 p-6">
          <p className="text-sm text-muted">Nada por aqui ainda. Quando você processar um áudio no servidor, ele aparece nesta lista.</p>
          <Link href="/estudio" className="text-sm text-violet-300 underline">
            Ir para o Estúdio
          </Link>
        </Card>
      ) : (
        <>
          <ul className="flex flex-col gap-2">
            {rows.map((r) => {
              const st = statusOf(r, now);
              const available = r.status === "done" && new Date(r.expires_at).getTime() > now;
              const Icon = r.kind === "video" ? Film : AudioLines;
              return (
                <li key={r.id}>
                  <Card className="flex flex-col gap-3 p-4">
                    <div className="flex items-start gap-3">
                      <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-white/[0.06]">
                        <Icon className="size-5" aria-hidden />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold">
                          {r.kind === "video" ? "Vídeo" : "Áudio"} · {TARGET[r.target]}
                        </p>
                        <p className="text-xs text-muted">
                          {formatDateTime(r.created_at)}
                          {r.duration_s ? ` · ${formatDuration(r.duration_s)}` : ""}
                          {r.lufs !== null ? ` · ${Number(r.lufs).toFixed(1)} LUFS` : ""}
                        </p>
                      </div>
                      <Badge tone={st.tone}>{st.label}</Badge>
                    </div>
                    {r.status === "running" && <ProgressBar value={r.progress} label="Processando no servidor" />}
                    {r.status === "failed" && r.error_code && r.error_code !== "CANCELLED" && (
                      <p className="text-xs text-muted">{exportErrorInfo(r.error_code).message}</p>
                    )}
                    <div className="flex flex-wrap gap-2">
                      {available && (
                        <Button size="sm" variant="secondary" disabled={busyId === r.id} onClick={() => void download(r)}>
                          <Download className="size-4" aria-hidden /> Baixar de novo
                        </Button>
                      )}
                      {(r.status === "queued" || r.status === "running") && (
                        <Button size="sm" variant="secondary" disabled={busyId === r.id} onClick={() => void cancel(r)}>
                          <XCircle className="size-4" aria-hidden /> Cancelar
                        </Button>
                      )}
                      {(r.status === "failed" || r.status === "expired" || !available) && r.status !== "queued" && r.status !== "running" && (
                        <Link href="/estudio" className="inline-flex h-9 items-center text-sm text-violet-300 underline">
                          Processar de novo
                        </Link>
                      )}
                    </div>
                  </Card>
                </li>
              );
            })}
          </ul>
          {device.length > 0 && (
            <div className="flex flex-col gap-2">
              <h2 className="mt-2 text-sm font-semibold text-muted">Processados no seu aparelho</h2>
              <ul className="flex flex-col gap-2">
                {device.map((d) => {
                  const Icon = d.target === "video" ? Film : AudioLines;
                  return (
                    <li key={d.id}>
                      <Card className="flex items-start gap-3 p-4">
                        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-white/[0.06]">
                          <Icon className="size-5" aria-hidden />
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-semibold">
                            {d.target === "video" ? "Vídeo" : "Áudio"} · {TARGET[d.target]}
                          </p>
                          <p className="text-xs text-muted">{formatDateTime(d.created_at)} · o arquivo ficou salvo só neste aparelho</p>
                        </div>
                        <Badge tone="success">Baixado</Badge>
                      </Card>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </>
      )}
    </div>
  );
}
