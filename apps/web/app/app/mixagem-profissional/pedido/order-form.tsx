"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Upload, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";

type Service = { id: string; name: string; price_brl: number; max_stems: number };

type StemFile = {
  id: string;
  file: File;
  status: "pending" | "uploading" | "done" | "error";
  progress: number;
  stemId?: string;
};

export function OrderForm({ service, defaultServiceId }: { service: Service; defaultServiceId?: string }) {
  const router = useRouter();
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);

  const [projectName, setProjectName] = useState("");
  const [genre, setGenre] = useState("");
  const [bpm, setBpm] = useState("");
  const [notes, setNotes] = useState("");
  const [stems, setStems] = useState<StemFile[]>([]);
  const [creating, setCreating] = useState(false);
  const [orderId, setOrderId] = useState<string | null>(null);

  function addFiles(files: FileList | null) {
    if (!files) return;
    const newStems: StemFile[] = [];
    for (const f of Array.from(files)) {
      if (stems.length + newStems.length >= service.max_stems) break;
      newStems.push({ id: crypto.randomUUID(), file: f, status: "pending", progress: 0 });
    }
    setStems((prev) => [...prev, ...newStems]);
  }

  function removeStem(id: string) {
    setStems((prev) => prev.filter((s) => s.id !== id));
  }

  async function uploadStem(stem: StemFile, oid: string): Promise<boolean> {
    setStems((prev) => prev.map((s) => s.id === stem.id ? { ...s, status: "uploading" } : s));
    try {
      const initRes = await fetch("/api/pro/stems", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ order_id: oid, file_name: stem.file.name, size_bytes: stem.file.size }),
      });
      if (!initRes.ok) throw new Error((await initRes.json()).error ?? "Erro no upload");
      const { stem_id, upload_url } = (await initRes.json()) as { stem_id: string; upload_url: string };

      await fetch(upload_url, { method: "PUT", body: stem.file, headers: { "content-type": stem.file.type || "audio/wav" } });

      await fetch(`/api/pro/stems/${stem_id}/complete`, { method: "POST" });

      setStems((prev) => prev.map((s) => s.id === stem.id ? { ...s, status: "done", stemId: stem_id } : s));
      return true;
    } catch (e) {
      setStems((prev) => prev.map((s) => s.id === stem.id ? { ...s, status: "error" } : s));
      return false;
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!projectName.trim()) return;
    setCreating(true);

    try {
      // 1. Cria pedido
      const orderRes = await fetch("/api/pro/orders", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          service_id: service.id,
          project_name: projectName.trim(),
          genre: genre.trim() || undefined,
          bpm: bpm ? Number(bpm) : undefined,
          notes: notes.trim() || undefined,
        }),
      });
      if (!orderRes.ok) {
        toast.error((await orderRes.json()).error ?? "Erro ao criar pedido.");
        return;
      }
      const { order_id } = (await orderRes.json()) as { order_id: string };
      setOrderId(order_id);

      // 2. Upload dos stems em paralelo (max 3 simultâneos)
      const pending = [...stems];
      const chunk = (arr: StemFile[], size: number) =>
        Array.from({ length: Math.ceil(arr.length / size) }, (_, i) => arr.slice(i * size, i * size + size));

      for (const batch of chunk(pending, 3)) {
        await Promise.all(batch.map((s) => uploadStem(s, order_id)));
      }

      // 3. Vai para o pedido (pagamento será feito lá)
      toast.success("Pedido criado! Agora finalize o pagamento.");
      router.push(`/app/mixagem-profissional/pedidos/${order_id}`);
    } catch {
      toast.error("Erro inesperado. Tente novamente.");
    } finally {
      setCreating(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-6">
      {/* Dados do projeto */}
      <fieldset className="flex flex-col gap-4">
        <legend className="font-medium">Sobre o projeto</legend>
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="text-muted">Nome do projeto *</span>
          <input
            required
            value={projectName}
            onChange={(e) => setProjectName(e.target.value)}
            placeholder="Ex: Minha Música — Voz e Violão"
            className="rounded-xl border border-border bg-bg-elev px-4 py-2.5 text-text outline-none focus:border-primary"
          />
        </label>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="text-muted">Gênero</span>
            <input
              value={genre}
              onChange={(e) => setGenre(e.target.value)}
              placeholder="Ex: MPB, Sertanejo, Pop"
              className="rounded-xl border border-border bg-bg-elev px-4 py-2.5 text-text outline-none focus:border-primary"
            />
          </label>
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="text-muted">BPM (opcional)</span>
            <input
              type="number"
              min={40}
              max={300}
              value={bpm}
              onChange={(e) => setBpm(e.target.value)}
              placeholder="Ex: 120"
              className="rounded-xl border border-border bg-bg-elev px-4 py-2.5 text-text outline-none focus:border-primary"
            />
          </label>
        </div>
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="text-muted">Orientações para o mixer</span>
          <textarea
            rows={3}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Descreva o resultado que você espera: referências musicais, detalhes de instrumentação, etc."
            className="resize-none rounded-xl border border-border bg-bg-elev px-4 py-2.5 text-text outline-none focus:border-primary"
          />
        </label>
      </fieldset>

      {/* Upload dos stems */}
      <fieldset className="flex flex-col gap-3">
        <legend className="font-medium">
          Stems ({stems.length}/{service.max_stems})
        </legend>
        <div
          className="flex flex-col items-center gap-3 rounded-2xl border-2 border-dashed border-border p-8 text-center cursor-pointer hover:border-primary/50 transition"
          onClick={() => fileRef.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => { e.preventDefault(); addFiles(e.dataTransfer.files); }}
        >
          <Upload className="size-8 text-muted" />
          <div>
            <p className="font-medium">Arraste os stems aqui</p>
            <p className="text-xs text-muted mt-1">WAV, FLAC ou AIFF · até 200 MB por arquivo</p>
          </div>
          <Button type="button" variant="secondary" size="sm" onClick={(e) => { e.stopPropagation(); fileRef.current?.click(); }}>
            Selecionar arquivos
          </Button>
        </div>
        <input
          ref={fileRef}
          type="file"
          multiple
          accept=".wav,.flac,.aiff,.aif"
          className="hidden"
          onChange={(e) => addFiles(e.target.files)}
        />

        {stems.length > 0 && (
          <ul className="flex flex-col gap-2">
            {stems.map((s) => (
              <li key={s.id} className="flex items-center gap-3 rounded-xl border border-border bg-bg-elev px-4 py-2.5 text-sm">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{s.file.name}</p>
                  <p className="text-xs text-subtle">{(s.file.size / 1024 / 1024).toFixed(1)} MB</p>
                </div>
                <span className={
                  s.status === "done" ? "text-green-400 text-xs" :
                  s.status === "uploading" ? "text-violet-300 text-xs" :
                  s.status === "error" ? "text-red-400 text-xs" : "text-subtle text-xs"
                }>
                  {s.status === "done" ? "✓" : s.status === "uploading" ? "Enviando…" : s.status === "error" ? "Erro" : "Pendente"}
                </span>
                {s.status !== "uploading" && s.status !== "done" && (
                  <button type="button" onClick={() => removeStem(s.id)} className="text-subtle hover:text-text">
                    <X className="size-4" />
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </fieldset>

      {/* Resumo e envio */}
      <div className="flex flex-col gap-3 rounded-2xl border border-border bg-bg-elev p-5">
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted">{service.name}</span>
          <span className="font-semibold">R$ {Number(service.price_brl).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}</span>
        </div>
        <p className="text-xs text-subtle">O pagamento será feito na próxima etapa (PIX ou cartão via Mercado Pago).</p>
        <Button type="submit" loading={creating} disabled={!projectName.trim()} className="w-full">
          {creating ? "Criando pedido…" : "Continuar para pagamento"}
        </Button>
      </div>
    </form>
  );
}
