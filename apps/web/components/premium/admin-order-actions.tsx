"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { RotateCcw, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";

async function act(body: Record<string, unknown>) {
  const r = await fetch("/api/admin/premium", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const j = (await r.json().catch(() => ({}))) as { error?: string; resultado?: string };
  if (!r.ok) throw new Error(j.error ?? "Não foi possível.");
  return j;
}

/** Estornar (devolve o dinheiro ou os créditos e corta o acesso) e Refazer (novo processamento, sem cobrar). */
export function OrderActions({ orderId, projectId, product, status }: { orderId: string; projectId: string | null; product: string; status: string }) {
  const toast = useToast();
  const router = useRouter();
  const [busy, setBusy] = useState<"refund" | "redo" | null>(null);
  if (status !== "paid") return <span className="text-xs text-subtle">—</span>;

  async function run(kind: "refund" | "redo") {
    if (kind === "refund") {
      const note = window.prompt("Estornar este pedido? O valor volta para a pessoa e o acesso aos arquivos termina.\n\nMotivo (opcional, fica registrado):", "");
      if (note === null) return;
      setBusy("refund");
      try {
        const r = await act({ action: "refund", order_id: orderId, note });
        toast.success(`Estornado: ${r.resultado ?? "ok"}.`);
        router.refresh();
      } catch (e) {
        toast.error((e as Error).message);
      } finally {
        setBusy(null);
      }
      return;
    }
    if (!window.confirm("Refazer o trabalho completo deste projeto? Não cobra de novo e substitui os arquivos quando terminar.")) return;
    setBusy("redo");
    try {
      await act({ action: "redo", project_id: projectId });
      toast.success("Refazendo. A pessoa é avisada quando ficar pronto.");
      router.refresh();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <span className="flex gap-1">
      {projectId && product !== "eng_finaliza" && (
        <Button size="sm" variant="secondary" loading={busy === "redo"} onClick={() => void run("redo")}>
          <RotateCcw className="size-3.5" aria-hidden /> Refazer
        </Button>
      )}
      <Button size="sm" variant="ghost" loading={busy === "refund"} onClick={() => void run("refund")}>
        <Undo2 className="size-3.5" aria-hidden /> Estornar
      </Button>
    </span>
  );
}
