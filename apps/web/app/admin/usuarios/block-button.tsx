"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useToast } from "@/components/ui/toast";

export function BlockButton({ userId, blocked }: { userId: string; blocked: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  async function toggle() {
    setBusy(true);
    const res = await fetch("/api/admin/users/block", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user_id: userId, block: !blocked }),
    });
    setBusy(false);
    if (!res.ok) {
      toast.error("Erro ao atualizar usuário.");
    } else {
      toast.success(blocked ? "Usuário desbloqueado." : "Usuário bloqueado.");
      router.refresh();
    }
  }

  return (
    <button
      disabled={busy}
      onClick={toggle}
      className={`h-7 rounded-lg px-2 text-xs disabled:opacity-50 ${blocked ? "bg-green-900/30 text-green-300 hover:bg-green-900/50" : "bg-red-900/30 text-red-300 hover:bg-red-900/50"}`}
    >
      {blocked ? "Desbloquear" : "Bloquear"}
    </button>
  );
}
