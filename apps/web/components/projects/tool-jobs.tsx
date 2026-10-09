"use client";

import { useCallback, useEffect, useState } from "react";
import { Download, Loader2, Wand2, XCircle } from "lucide-react";
import { Badge, type Tone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ProgressBar } from "@/components/ui/misc";
import { useToast } from "@/components/ui/toast";
import { formatDateTime } from "@/lib/cn";
import { supabaseBrowser } from "@/lib/supabase/client";

type Row = {
  id: string;
  tool: string;
  status: "queued" | "running" | "done" | "failed" | "expired";
  progress: number;
  credits: number;
  error_code: string | null;
  outputs: { name: string; bytes: number }[];
  created_at: string;
  expires_at: string;
};

const NAMES: Record<string, string> = {
  pitch_tempo: "Tom e andamento",
  voice_playback: "Voz + Playback",
  reference_master: "Masterização por referência",
  album: "Modo álbum",
  stems: "Faixas separadas",
  convert: "Conversão de formato",
};

function statusOf(r: Row, now: number): { label: string; tone: Tone } {
  if (r.status === "queued") return { label: "Na fila", tone: "info" };
  if (r.status === "running") return { label: "Processando", tone: "primary" };
  if (r.status === "done" && new Date(r.expires_at).getTime() > now) return { label: "Concluído", tone: "success" };
  if (r.status === "done" || r.status === "expired") return { label: "Arquivos expirados", tone: "neutral" };
  return r.error_code === "CANCELLED" ? { label: "Cancelado", tone: "neutral" } : { label: "Não concluído", tone: "danger" };
}

/** Jobs das ferramentas (Meus projetos): baixar cada arquivo enquanto estiver no prazo (24 h ou Cofre de 30 dias). */
export function ToolJobsList() {
  const toast = useToast();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [now, setNow] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data, error } = await supabaseBrowser()
      .from("my_tool_jobs")
      .select("id,tool,status,progress,credits,error_code,outputs,created_at,expires_at")
      .order("created_at", { ascending: false })
      .limit(50);
    // a visão só existe depois da migração das ferramentas: sem ela, a seção não aparece
    if (!error) {
      setRows((data ?? []) as Row[]);
      setNow(Date.now());
    } else setRows([]);
  }, []);

  useEffect(() => {
    // chamada de rede; o estado muda quando ela responde
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);
  const active = rows?.some((r) => r.status === "queued" || r.status === "running") ?? false;
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => void load(), 4000);
    return () => clearInterval(t);
  }, [active, load]);

  async function download(r: Row, i: number) {
    setBusy(`${r.id}:${i}`);
    try {
      const res = await fetch(`/api/tools/jobs/${r.id}`, { cache: "no-store" });
      const body = (await res.json()) as { outputs?: { url: string }[] };
      const url = body.outputs?.[i]?.url;
      if (!url) throw new Error();
      window.location.assign(url);
    } catch {
      toast.error("Este arquivo não está mais disponível.");
    } finally {
      setBusy(null);
    }
  }

  async function cancel(r: Row) {
    setBusy(r.id);
    try {
      const res = await fetch(`/api/tools/jobs/${r.id}/cancel`, { method: "POST" });
      if (!res.ok) throw new Error();
      toast.success("Cancelado. Nenhum crédito foi usado.");
      await load();
    } catch {
      toast.error("Não foi possível cancelar agora.");
    } finally {
      setBusy(null);
    }
  }

  if (rows === null)
    return (
      <p className="flex items-center gap-2 text-sm text-muted">
        <Loader2 className="size-4 animate-spin" aria-hidden /> Carregando…
      </p>
    );
  if (!rows.length) return null;
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-sm font-semibold text-muted">Ferramentas</h2>
      <ul className="flex flex-col gap-2">
        {rows.map((r) => {
          const st = statusOf(r, now);
          const alive = r.status === "done" && new Date(r.expires_at).getTime() > now;
          return (
            <li key={r.id}>
              <Card className="flex flex-col gap-3 p-4">
                <div className="flex items-start gap-3">
                  <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-white/[0.06]">
                    <Wand2 className="size-5" aria-hidden />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold">{NAMES[r.tool] ?? r.tool}</p>
                    <p className="text-xs text-muted">
                      {formatDateTime(r.created_at)}
                      {r.credits ? ` · ${r.credits} crédito${r.credits > 1 ? "s" : ""}` : ""}
                      {alive ? ` · disponível até ${formatDateTime(r.expires_at)}` : ""}
                    </p>
                  </div>
                  <Badge tone={st.tone}>{st.label}</Badge>
                </div>
                {r.status === "running" && <ProgressBar value={r.progress} label="Processando" />}
                <div className="flex flex-wrap gap-2">
                  {alive &&
                    r.outputs.map((o, i) => (
                      <Button key={o.name} size="sm" variant={o.name.endsWith(".zip") ? "primary" : "secondary"} disabled={busy === `${r.id}:${i}`} onClick={() => void download(r, i)}>
                        <Download className="size-4" aria-hidden /> {o.name.endsWith(".zip") ? "Baixar tudo" : o.name}
                      </Button>
                    ))}
                  {(r.status === "queued" || r.status === "running") && (
                    <Button size="sm" variant="secondary" disabled={busy === r.id} onClick={() => void cancel(r)}>
                      <XCircle className="size-4" aria-hidden /> Cancelar
                    </Button>
                  )}
                </div>
              </Card>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
