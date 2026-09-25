"use client";

import { useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { useToast } from "@/components/ui/toast";

export function SettingRow({ k, value, description }: { k: string; value: unknown; description: string | null }) {
  const toast = useToast();
  const initial = JSON.stringify(value);
  const [text, setText] = useState(initial);
  const [saved, setSaved] = useState(initial);
  const [busy, setBusy] = useState(false);

  async function save() {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return toast.error(`Valor inválido para ${k}. Use JSON (ex.: 5, "texto", ["wav","mp3"], true).`);
    }
    if (typeof parsed !== typeof value && !(Array.isArray(parsed) && Array.isArray(value))) {
      return toast.error(`${k} deve ser do tipo ${Array.isArray(value) ? "lista" : typeof value}.`);
    }
    setBusy(true);
    const { error } = await supabaseBrowser()
      .from("system_settings")
      .update({ value: parsed, updated_at: new Date().toISOString() })
      .eq("key", k);
    setBusy(false);
    if (error) return toast.error("Erro ao salvar.");
    setSaved(text);
    toast.success(`${k} atualizado.`);
  }

  return (
    <div className="flex flex-col gap-2 px-5 py-4 md:flex-row md:items-center md:justify-between">
      <div className="min-w-0">
        <p className="font-mono text-sm">{k}</p>
        {description && <p className="text-xs text-muted">{description}</p>}
      </div>
      <div className="flex gap-2">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          aria-label={k}
          className="h-9 w-full rounded-lg border border-border-strong bg-black/20 px-3 font-mono text-xs outline-none focus:border-violet-400 md:w-72"
        />
        <button
          onClick={save}
          disabled={busy || text === saved}
          className="h-9 rounded-lg bg-white/10 px-3 text-xs hover:bg-white/15 disabled:opacity-40"
        >
          Salvar
        </button>
      </div>
    </div>
  );
}
