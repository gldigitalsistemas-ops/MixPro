"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useToast } from "@/components/ui/toast";
import { supabaseBrowser } from "@/lib/supabase/client";

/** Marcar o grupo como resolvido (some da lista até acontecer de novo) ou apagar os registros. */
export function LogActions({ fingerprint, resolved }: { fingerprint: string; resolved: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  async function act(kind: "resolve" | "reopen" | "delete") {
    if (kind === "delete" && !confirm("Apagar todos os registros deste erro?")) return;
    setBusy(true);
    const t = supabaseBrowser().from("app_errors");
    const { error } =
      kind === "delete"
        ? await t.delete().eq("fingerprint", fingerprint)
        : kind === "resolve"
          ? await t.update({ resolved_at: new Date().toISOString() }).eq("fingerprint", fingerprint).is("resolved_at", null)
          : await t.update({ resolved_at: null }).eq("fingerprint", fingerprint);
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success(kind === "delete" ? "Registros apagados." : kind === "resolve" ? "Marcado como resolvido. Se acontecer de novo, volta para a lista." : "Reaberto.");
    router.refresh();
  }

  const btn = "h-8 rounded-lg px-3 text-xs font-medium disabled:opacity-50";
  return (
    <div className="flex gap-2">
      {resolved ? (
        <button type="button" disabled={busy} onClick={() => act("reopen")} className={`${btn} border border-border hover:bg-white/5`}>
          Reabrir
        </button>
      ) : (
        <button type="button" disabled={busy} onClick={() => act("resolve")} className={`${btn} bg-green-900/30 text-green-300 hover:bg-green-900/50`}>
          Marcar como resolvido
        </button>
      )}
      <button type="button" disabled={busy} onClick={() => act("delete")} className={`${btn} bg-red-900/30 text-red-300 hover:bg-red-900/50`}>
        Apagar
      </button>
    </div>
  );
}
