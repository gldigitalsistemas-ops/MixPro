"use client";

import { useMemo, useState } from "react";
import { Search, Star } from "lucide-react";
import { Chip, EmptyState } from "@/components/ui/misc";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/cn";
import type { PresetCategory } from "@/lib/types";

export type BrowserPreset = {
  id: string;
  name: string;
  description: string | null;
  style: string | null;
  category_id: string;
  version_id: string | null;
  image_url: string | null;
  active: boolean;
};

type Props = {
  presets: BrowserPreset[];
  categories: PresetCategory[];
  initialCategory: string | null;
  favorites: Set<string>;
  selectedId: string | null;
  appliedId: string | null;
  onSelect: (p: BrowserPreset) => void;
  onToggleFavorite: (presetId: string) => void;
};

const STYLE_HUE: Record<string, string> = {
  punchy: "from-orange-500/40",
  warm: "from-amber-500/40",
  bright: "from-sky-400/40",
  clean: "from-emerald-400/40",
  aggressive: "from-red-500/40",
  modern: "from-violet-500/40",
  vintage: "from-yellow-600/40",
  deep: "from-indigo-600/40",
  wide: "from-cyan-500/40",
  natural: "from-green-500/40",
  radio: "from-pink-500/40",
  heavy: "from-rose-600/40",
  intimate: "from-fuchsia-500/40",
};

export function PresetBrowser({
  presets,
  categories,
  initialCategory,
  favorites,
  selectedId,
  appliedId,
  onSelect,
  onToggleFavorite,
}: Props) {
  const [tab, setTab] = useState<"all" | "fav">("all");
  const [category, setCategory] = useState<string | null>(initialCategory);
  const [q, setQ] = useState("");

  const usedCategories = useMemo(() => {
    const ids = new Set(presets.map((p) => p.category_id));
    return categories.filter((c) => ids.has(c.id));
  }, [presets, categories]);

  const visible = useMemo(() => {
    const term = q.trim().toLowerCase();
    return presets.filter(
      (p) =>
        (tab === "fav" ? favorites.has(p.id) : !category || p.category_id === category) &&
        (!term || p.name.toLowerCase().includes(term) || (p.description ?? "").toLowerCase().includes(term)),
    );
  }, [presets, tab, category, q, favorites]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-1 rounded-full border border-border p-1 text-sm" role="tablist">
        {(["all", "fav"] as const).map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={cn("flex-1 rounded-full py-1.5 transition", tab === t ? "bg-brand text-white" : "text-muted hover:text-text")}
          >
            {t === "all" ? "Presets" : `Favoritos${favorites.size ? ` (${favorites.size})` : ""}`}
          </button>
        ))}
      </div>

      <label className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-subtle" aria-hidden />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Buscar presets…"
          aria-label="Buscar presets"
          className="h-10 w-full rounded-xl border border-border bg-black/20 pl-9 pr-3 text-sm outline-none focus:border-violet-400"
        />
      </label>

      {tab === "all" && usedCategories.length > 1 && (
        <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1" aria-label="Categorias">
          <Chip active={!category} onClick={() => setCategory(null)}>
            Todos
          </Chip>
          {usedCategories.map((c) => (
            <Chip key={c.id} active={category === c.id} onClick={() => setCategory(c.id)}>
              {c.name}
            </Chip>
          ))}
        </div>
      )}

      {visible.length === 0 ? (
        <EmptyState
          title={tab === "fav" ? "Nenhum favorito ainda" : "Nenhum preset aqui"}
          description={
            tab === "fav"
              ? "Toque na estrela de um preset para guardá-lo aqui."
              : "Ainda não há presets publicados para esta categoria."
          }
          className="py-8"
        />
      ) : (
        <ul className="flex max-h-[28rem] flex-col gap-2 overflow-y-auto pr-1">
          {visible.map((p) => {
            const selected = p.id === selectedId;
            return (
              <li key={p.id}>
                <div
                  className={cn(
                    "group flex items-center gap-3 rounded-2xl border p-2.5 transition",
                    selected ? "border-violet-400 bg-primary/12 shadow-[0_0_0_1px] shadow-violet-400/40" : "border-border hover:bg-white/[0.04]",
                  )}
                >
                  <button onClick={() => onSelect(p)} className="flex min-w-0 flex-1 items-center gap-3 text-left" aria-pressed={selected}>
                    <span
                      className={cn(
                        "grid size-12 shrink-0 place-items-center overflow-hidden rounded-xl bg-gradient-to-br to-transparent text-xs font-semibold uppercase text-white/80",
                        STYLE_HUE[p.style ?? ""] ?? "from-violet-500/40",
                      )}
                      style={p.image_url ? { backgroundImage: `url(${p.image_url})`, backgroundSize: "cover" } : undefined}
                      aria-hidden
                    >
                      {!p.image_url && p.name.split(" ").pop()?.slice(0, 2)}
                    </span>
                    <span className="min-w-0">
                      <span className="flex items-center gap-2 text-sm font-medium">
                        <span className="truncate">{p.name}</span>
                        {p.id === appliedId && <Badge tone="success">Aplicado</Badge>}
                        {!p.active && <Badge tone="warning">Inativo</Badge>}
                      </span>
                      <span className="block truncate text-xs text-muted">{p.description}</span>
                    </span>
                  </button>
                  <button
                    onClick={() => onToggleFavorite(p.id)}
                    aria-label={favorites.has(p.id) ? `Remover ${p.name} dos favoritos` : `Favoritar ${p.name}`}
                    aria-pressed={favorites.has(p.id)}
                    className="rounded-full p-2 text-subtle hover:bg-white/5 hover:text-amber-300"
                  >
                    <Star className={cn("size-4", favorites.has(p.id) && "fill-amber-300 text-amber-300")} />
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
