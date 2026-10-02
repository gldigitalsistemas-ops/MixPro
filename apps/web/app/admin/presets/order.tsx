"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, ChevronDown } from "lucide-react";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/cn";
import { SOUND_TABS, tabOrder, type SoundTab } from "@/lib/mix";
import { supabaseBrowser } from "@/lib/supabase/client";

type Cat = { id: string; name: string; group_id: string; position: number };

/** Ordem das abas de "Escolha o som" e das categorias dentro de cada aba, como o usuário vê no app. */
export function OrderEditor({ categories, savedTabs }: { categories: Cat[]; savedTabs: unknown }) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [tabs, setTabs] = useState<SoundTab[]>(() => tabOrder(savedTabs));
  const [cats, setCats] = useState<Cat[]>(() => [...categories].sort((a, b) => a.position - b.position));
  const [busy, setBusy] = useState(false);

  const move = <T,>(list: T[], i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= list.length) return list;
    const next = [...list];
    [next[i], next[j]] = [next[j], next[i]];
    return next;
  };

  async function saveTabs(next: SoundTab[]) {
    setTabs(next);
    setBusy(true);
    const { error } = await supabaseBrowser()
      .from("system_settings")
      .upsert({ key: "studio_tabs", value: next, is_public: true, description: "Ordem das abas de “Escolha o som” no estúdio." });
    setBusy(false);
    if (error) toast.error(`Não salvou: ${error.message}`);
  }

  async function moveCat(groupCats: Cat[], i: number, d: -1 | 1) {
    const ordered = move(groupCats, i, d);
    if (ordered === groupCats) return;
    // renumera a aba inteira (posições repetidas deixavam a ordem imprevisível)
    const positions = ordered.map((c, k) => ({ ...c, position: k }));
    setCats((all) => all.map((c) => positions.find((p) => p.id === c.id) ?? c).sort((a, b) => a.position - b.position));
    setBusy(true);
    const sb = supabaseBrowser();
    const results = await Promise.all(positions.map((c) => sb.from("preset_categories").update({ position: c.position }).eq("id", c.id)));
    setBusy(false);
    const failed = results.find((r) => r.error);
    if (failed?.error) toast.error(`Não salvou: ${failed.error.message}`);
    else router.refresh();
  }

  const btn = "rounded-lg p-1.5 text-muted hover:bg-white/5 hover:text-text disabled:opacity-30";
  return (
    <div className="rounded-2xl border border-border">
      <button type="button" onClick={() => setOpen(!open)} className="flex w-full items-center justify-between gap-3 p-4 text-left" aria-expanded={open}>
        <span>
          <span className="block font-medium">Ordem no app</span>
          <span className="block text-xs text-muted">Organize as abas de “Escolha o som” e as categorias de cada uma, na ordem em que o usuário vê.</span>
        </span>
        <ChevronDown className={cn("size-4 shrink-0 text-muted transition", open && "rotate-180")} />
      </button>
      {open && (
        <div className="grid gap-4 border-t border-border p-4 md:grid-cols-2">
          <section className="flex flex-col gap-2">
            <h3 className="text-xs font-medium uppercase tracking-wider text-muted">Abas</h3>
            <ol className="flex flex-col gap-1">
              {tabs.map((t, i) => (
                <li key={t} className="flex items-center gap-2 rounded-xl border border-border px-3 py-2 text-sm">
                  <span className="w-5 text-xs text-subtle">{i + 1}</span>
                  <span className="flex-1 font-medium">{SOUND_TABS[t].label}</span>
                  <button type="button" disabled={busy || i === 0} onClick={() => saveTabs(move(tabs, i, -1))} className={btn} aria-label={`Subir ${SOUND_TABS[t].label}`}>
                    <ArrowUp className="size-4" />
                  </button>
                  <button type="button" disabled={busy || i === tabs.length - 1} onClick={() => saveTabs(move(tabs, i, 1))} className={btn} aria-label={`Descer ${SOUND_TABS[t].label}`}>
                    <ArrowDown className="size-4" />
                  </button>
                </li>
              ))}
            </ol>
            <p className="text-xs text-subtle">“Meus” fica sempre por último.</p>
          </section>
          <section className="flex flex-col gap-3">
            {tabs
              .filter((t) => SOUND_TABS[t].groups.length)
              .map((t) => {
                const groupCats = cats.filter((c) => SOUND_TABS[t].groups.includes(c.group_id));
                if (!groupCats.length) return null;
                return (
                  <div key={t} className="flex flex-col gap-1">
                    <h3 className="text-xs font-medium uppercase tracking-wider text-muted">Categorias em {SOUND_TABS[t].label}</h3>
                    <ol className="flex flex-col gap-1">
                      {groupCats.map((c, i) => (
                        <li key={c.id} className="flex items-center gap-2 rounded-xl border border-border px-3 py-1.5 text-sm">
                          <span className="flex-1">{c.name}</span>
                          <button type="button" disabled={busy || i === 0} onClick={() => moveCat(groupCats, i, -1)} className={btn} aria-label={`Subir ${c.name}`}>
                            <ArrowUp className="size-4" />
                          </button>
                          <button type="button" disabled={busy || i === groupCats.length - 1} onClick={() => moveCat(groupCats, i, 1)} className={btn} aria-label={`Descer ${c.name}`}>
                            <ArrowDown className="size-4" />
                          </button>
                        </li>
                      ))}
                    </ol>
                  </div>
                );
              })}
          </section>
        </div>
      )}
    </div>
  );
}
