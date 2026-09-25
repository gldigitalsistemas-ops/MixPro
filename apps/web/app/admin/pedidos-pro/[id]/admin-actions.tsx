"use client";

import { useRef, useState } from "react";
import { Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { supabaseBrowser } from "@/lib/supabase/client";

type AdminOrderActionsProps = {
  orderId: string;
  currentStatus: string;
  hasDelivery: boolean;
};

const STATUS_OPTIONS = [
  { value: "paid", label: "Pago / recebido" },
  { value: "in_progress", label: "Em andamento" },
  { value: "waiting_revision", label: "Aguardando aprovação do cliente" },
  { value: "delivered", label: "Entregue (aprovado)" },
  { value: "cancelled", label: "Cancelar pedido" },
];

export function AdminOrderActions({ orderId, currentStatus, hasDelivery }: AdminOrderActionsProps) {
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [newStatus, setNewStatus] = useState(currentStatus);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadFile, setUploadFile] = useState<File | null>(null);

  async function handleStatusChange() {
    if (newStatus === currentStatus) return;
    setSaving(true);
    try {
      const { error } = await supabaseBrowser().rpc("admin_update_order_status", {
        p_order_id: orderId,
        p_status: newStatus,
      });
      if (error) throw error;
      toast.success("Status atualizado.");
      window.location.reload();
    } catch { toast.error("Erro ao atualizar status."); }
    finally { setSaving(false); }
  }

  async function handleDeliveryUpload() {
    if (!uploadFile) return;
    setUploading(true);
    try {
      // 1. Pede URL assinada para upload da entrega
      const res = await fetch(`/api/pro/admin/delivery-upload`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ order_id: orderId, file_name: uploadFile.name, size_bytes: uploadFile.size }),
      });
      if (!res.ok) { toast.error((await res.json()).error ?? "Erro."); return; }
      const { upload_url, delivery_key } = (await res.json()) as { upload_url: string; delivery_key: string };

      // 2. Upload para o R2
      await fetch(upload_url, { method: "PUT", body: uploadFile, headers: { "content-type": uploadFile.type || "audio/wav" } });

      // 3. Confirma entrega
      const conf = await fetch(`/api/pro/admin/delivery-confirm`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ order_id: orderId, delivery_key }),
      });
      if (!conf.ok) { toast.error("Erro ao confirmar entrega."); return; }

      toast.success("Entrega enviada! Cliente já pode baixar.");
      window.location.reload();
    } catch { toast.error("Erro no upload da entrega."); }
    finally { setUploading(false); }
  }

  return (
    <div className="flex flex-col gap-4 rounded-2xl border border-border p-5">
      <p className="font-medium text-sm">Ações admin</p>

      {/* Mudar status */}
      <div className="flex gap-2">
        <select
          value={newStatus}
          onChange={(e) => setNewStatus(e.target.value)}
          className="flex-1 rounded-xl border border-border bg-bg-elev px-3 py-2 text-sm text-text outline-none focus:border-primary"
        >
          {STATUS_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        <Button size="sm" onClick={handleStatusChange} loading={saving} disabled={newStatus === currentStatus}>
          Salvar
        </Button>
      </div>

      {/* Upload da entrega */}
      <div className="flex flex-col gap-2">
        <p className="text-xs text-muted">
          {hasDelivery ? "Substituir entrega" : "Enviar entrega (muda status para 'Aguardando revisão' do cliente)"}
        </p>
        <div className="flex gap-2">
          <input
            ref={fileRef}
            type="file"
            accept=".wav,.flac,.mp3,.aiff,.aif"
            className="hidden"
            onChange={(e) => setUploadFile(e.target.files?.[0] ?? null)}
          />
          <Button variant="secondary" size="sm" onClick={() => fileRef.current?.click()}>
            <Upload className="size-4" />
            {uploadFile ? uploadFile.name : "Selecionar arquivo de entrega"}
          </Button>
          {uploadFile && (
            <Button size="sm" onClick={handleDeliveryUpload} loading={uploading}>
              Enviar
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
