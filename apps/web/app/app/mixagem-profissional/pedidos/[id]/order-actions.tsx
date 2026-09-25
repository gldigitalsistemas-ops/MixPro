"use client";

import { useState } from "react";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { supabaseBrowser } from "@/lib/supabase/client";

type OrderActionsProps = {
  order: {
    id: string;
    status: string;
    delivery_key: string | null;
    revisions_used: number;
    max_revisions: number;
  };
};

export function OrderActions({ order }: OrderActionsProps) {
  const toast = useToast();
  const [downloading, setDownloading] = useState(false);
  const [approving, setApproving] = useState(false);
  const [revising, setRevising] = useState(false);
  const [revisionNotes, setRevisionNotes] = useState("");
  const [showRevisionForm, setShowRevisionForm] = useState(false);

  const canDownload = ["waiting_revision", "revision_requested", "delivered"].includes(order.status);
  const canApprove = order.status === "waiting_revision" || order.status === "revision_requested";
  const canRevise = order.status === "waiting_revision" && order.revisions_used < order.max_revisions;
  const revisionsLeft = order.max_revisions - order.revisions_used;

  async function handleDownload() {
    setDownloading(true);
    try {
      const res = await fetch(`/api/pro/delivery?order_id=${order.id}`);
      if (!res.ok) { toast.error("Entrega ainda não disponível."); return; }
      const { url } = (await res.json()) as { url: string };
      window.open(url, "_blank");
    } catch { toast.error("Erro ao gerar link."); }
    finally { setDownloading(false); }
  }

  async function handleApprove() {
    setApproving(true);
    try {
      const { error } = await supabaseBrowser().rpc("approve_delivery", { p_order_id: order.id });
      if (error) throw error;
      toast.success("Entrega aprovada! Obrigado.");
      window.location.reload();
    } catch { toast.error("Erro ao aprovar entrega."); }
    finally { setApproving(false); }
  }

  async function handleRevision() {
    if (!revisionNotes.trim()) return;
    setRevising(true);
    try {
      const { error } = await supabaseBrowser().rpc("request_revision", {
        p_order_id: order.id,
        p_notes: revisionNotes.trim(),
      });
      if (error) throw error;
      toast.success("Revisão solicitada com sucesso.");
      window.location.reload();
    } catch (e: unknown) {
      const msg = e && typeof e === "object" && "message" in e ? String((e as { message: unknown }).message) : "";
      toast.error(msg.includes("REVISIONS_EXHAUSTED") ? "Limite de revisões atingido." : "Erro ao solicitar revisão.");
    }
    finally { setRevising(false); }
  }

  if (!canDownload && !canApprove && !canRevise) return null;

  return (
    <div className="flex flex-col gap-3">
      {canDownload && (
        <Button onClick={handleDownload} loading={downloading} className="w-full">
          <Download className="size-4" />
          Baixar entrega
        </Button>
      )}
      {canApprove && (
        <Button variant="secondary" onClick={handleApprove} loading={approving} className="w-full">
          Aprovar entrega
        </Button>
      )}
      {canRevise && !showRevisionForm && (
        <Button variant="ghost" onClick={() => setShowRevisionForm(true)} className="w-full text-sm">
          Solicitar revisão ({revisionsLeft} restante{revisionsLeft !== 1 ? "s" : ""})
        </Button>
      )}
      {showRevisionForm && (
        <div className="flex flex-col gap-2 rounded-2xl border border-border p-4">
          <p className="text-sm font-medium">O que precisa ser ajustado?</p>
          <textarea
            rows={3}
            value={revisionNotes}
            onChange={(e) => setRevisionNotes(e.target.value)}
            placeholder="Descreva o que precisa mudar…"
            className="resize-none rounded-xl border border-border bg-bg-elev px-3 py-2 text-sm text-text outline-none focus:border-primary"
          />
          <div className="flex gap-2">
            <Button size="sm" onClick={handleRevision} loading={revising} disabled={!revisionNotes.trim()}>
              Enviar revisão
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setShowRevisionForm(false)}>
              Cancelar
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
