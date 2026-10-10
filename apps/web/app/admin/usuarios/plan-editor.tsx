"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { useToast } from "@/components/ui/toast";

/** Concede um plano até uma data (fim do dia, horário de Brasília). Depois, a pessoa volta ao plano que tinha. */
export function PlanEditor({ userId, grant }: { userId: string; grant: { plan: string; until: string } | null }) {
  const router = useRouter();
  const toast = useToast();
  const [plan, setPlan] = useState(grant?.plan ?? "pro");
  const [until, setUntil] = useState(grant?.until ?? "");
  const [busy, setBusy] = useState(false);

  async function save(remove: boolean) {
    if (!remove && !until) return toast.error("Escolha até quando vale o plano.");
    setBusy(true);
    const { error } = await supabaseBrowser().rpc("admin_set_plan", {
      p_user: userId,
      p_plan: remove ? null : plan,
      p_until: remove ? null : `${until}T23:59:59-03:00`,
      p_note: "",
    });
    setBusy(false);
    if (error) return toast.error(error.message.includes("INVALID") ? "Data inválida: escolha um dia a partir de hoje (até 3 anos)." : "Não foi possível alterar o plano.");
    toast.success(remove ? "Plano concedido removido." : "Plano concedido.");
    router.refresh();
  }

  return (
    <div className="flex flex-wrap items-center gap-1">
      <select
        value={plan}
        onChange={(e) => setPlan(e.target.value)}
        aria-label="Plano"
        className="h-8 rounded-lg border border-border-strong bg-black/20 px-1 text-xs"
      >
        <option value="pro">Pro</option>
        <option value="criador">Criador</option>
      </select>
      <input
        type="date"
        value={until}
        onChange={(e) => setUntil(e.target.value)}
        aria-label="Até"
        className="h-8 rounded-lg border border-border-strong bg-black/20 px-1 text-xs"
      />
      <button disabled={busy} onClick={() => void save(false)} className="h-8 rounded-lg bg-white/10 px-2 text-xs hover:bg-white/15 disabled:opacity-50">
        Aplicar
      </button>
      {grant && (
        <button disabled={busy} onClick={() => void save(true)} className="h-8 rounded-lg px-2 text-xs text-rose-300 hover:bg-white/5 disabled:opacity-50">
          Remover
        </button>
      )}
    </div>
  );
}
