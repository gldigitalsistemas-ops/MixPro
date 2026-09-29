"use client";

import { useEffect, useState } from "react";
import { Palette, Save } from "lucide-react";
import { useAccountCtx } from "@/components/account/account-provider";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { listStyles, saveStyle, type SavedStyle, type StyleSettings } from "@/lib/styles";
import { supabaseBrowser } from "@/lib/supabase/client";
import { track } from "@/lib/track";

const MAX_STYLES = 10;

/** "Meu estilo": salva preset, ruído, legendas, formato e cortes para aplicar tudo com um toque. */
export function StyleBar({ current, onApply }: { current: StyleSettings; onApply: (s: StyleSettings) => void }) {
  const { user, requireLogin } = useAccountCtx();
  const toast = useToast();
  const [styles, setStyles] = useState<SavedStyle[]>([]);
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");

  useEffect(() => {
    if (!user) return;
    listStyles().then(setStyles).catch(() => {});
  }, [user]);

  async function save() {
    if (!(await requireLogin("Entre para salvar o seu estilo e usar nos próximos vídeos."))) return;
    const n = name.trim() || "Meu estilo";
    if (styles.length >= MAX_STYLES && !styles.some((s) => s.name === n)) return toast.error(`Você pode ter até ${MAX_STYLES} estilos.`);
    try {
      const { data } = await supabaseBrowser().auth.getUser();
      await saveStyle(data.user!.id, n, current);
      setStyles(await listStyles());
      track("style_saved");
      setNaming(false);
      setName("");
      toast.success(`Estilo “${n}” salvo. Aplique nos próximos vídeos com um toque.`);
    } catch {
      toast.error("Não foi possível salvar o estilo.");
    }
  }

  if (naming) {
    return (
      <div className="flex gap-2">
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value.slice(0, 40))}
          onKeyDown={(e) => e.key === "Enter" && void save()}
          placeholder="Nome do estilo (ex.: Vlog, Podcast)"
          className="h-10 min-w-0 flex-1 rounded-xl border border-border-strong bg-black/20 px-3 text-sm outline-none focus:border-violet-400"
        />
        <Button size="sm" onClick={() => void save()}>
          Salvar
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setNaming(false)}>
          Cancelar
        </Button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <label className="relative flex h-10 min-w-0 flex-1 items-center gap-2 rounded-xl border border-border-strong px-3 text-sm">
        <Palette className="size-4 shrink-0 text-violet-300" aria-hidden />
        <select
          value=""
          onChange={(e) => {
            const st = styles.find((s) => s.id === e.target.value);
            if (st) onApply(st.settings);
          }}
          disabled={!styles.length}
          aria-label="Aplicar um estilo salvo"
          className="min-w-0 flex-1 appearance-none bg-transparent outline-none disabled:text-subtle"
        >
          <option value="">{styles.length ? "Aplicar meu estilo…" : "Nenhum estilo salvo"}</option>
          {styles.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </label>
      <Button size="sm" variant="secondary" onClick={() => setNaming(true)}>
        <Save className="size-4" /> Salvar estilo
      </Button>
    </div>
  );
}
