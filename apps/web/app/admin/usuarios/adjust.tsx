"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { useToast } from "@/components/ui/toast";

export function AdjustCredits({ userId }: { userId: string }) {
  const router = useRouter();
  const toast = useToast();
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  return (
    <form
      className="flex gap-1"
      onSubmit={async (e) => {
        e.preventDefault();
        const n = parseInt(amount, 10);
        if (!n || !reason.trim()) return toast.error("Informe quantidade (±) e motivo.");
        setBusy(true);
        const { error } = await supabaseBrowser().rpc("admin_adjust_credits", { p_user: userId, p_amount: n, p_reason: reason.trim() });
        setBusy(false);
        if (error) return toast.error(error.message.includes("INSUFFICIENT") ? "O saldo não pode ficar negativo." : "Erro ao ajustar.");
        setAmount("");
        setReason("");
        toast.success("Créditos ajustados.");
        router.refresh();
      }}
    >
      <input
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        placeholder="±N"
        aria-label="Quantidade"
        className="h-8 w-14 rounded-lg border border-border-strong bg-black/20 px-2 text-xs"
      />
      <input
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="Motivo"
        aria-label="Motivo"
        className="h-8 w-32 rounded-lg border border-border-strong bg-black/20 px-2 text-xs"
      />
      <button disabled={busy} className="h-8 rounded-lg bg-white/10 px-2 text-xs hover:bg-white/15 disabled:opacity-50">
        OK
      </button>
    </form>
  );
}
