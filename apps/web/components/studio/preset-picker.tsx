"use client";

import { useMemo, useState } from "react";
import { Check, Star, Trash2 } from "lucide-react";
import { Chip } from "@/components/ui/misc";
import { cn } from "@/lib/cn";
import type { StudioCategory, StudioPreset } from "@/lib/presets";

export const GROUPS = [
  { id: "voz", label: "Voz", groups: ["vocal"] },
  { id: "instrumentos", label: "Instrumentos", groups: ["drums", "bass", "guitar", "acoustic", "piano"] },
  { id: "musica", label: "Música pronta", groups: ["master"] },
] as const;

const STYLE_HUE: Record<string, string> = {
  punchy: "from-orange-500/50",
  warm: "from-amber-500/50",
  bright: "from-sky-400/50",
  clean: "from-emerald-400/50",
  aggressive: "from-red-500/50",
  gritty: "from-red-500/50",
  heavy: "from-rose-600/50",
  deep: "from-indigo-600/50",
  "sub-heavy": "from-indigo-600/50",
  wide: "from-cyan-500/50",
  natural: "from-green-500/50",
  transparent: "from-green-500/50",
  vintage: "from-yellow-600/50",
  epic: "from-fuchsia-500/50",
  powerful: "from-fuchsia-500/50",
  loud: "from-violet-500/50",
  balanced: "from-teal-500/50",
};

type Props = {
  presets: StudioPreset[];
  categories: StudioCategory[];
  categoryId: string | null;
  onCategory: (id: string) => void;
  selectedId: string | null;
  onSelect: (p: StudioPreset) => void;
  favorites: Set<string>;
  onToggleFavorite: (p: StudioPreset) => void;
  /** Presets personalizados do usuário (aba "Meus"). */
  userPresets: StudioPreset[];
  onDeleteUserPreset: (p: StudioPreset) => void;
};

export function PresetPicker({
  presets,
  categories,
  categoryId,
  onCategory,
  selectedId,
  onSelect,
  favorites,
  onToggleFavorite,
  userPresets,
  onDeleteUserPreset,
}: Props) {
  // abre em "Meus" quando o preset em uso é um preset do usuário
  const [favMode, setFavMode] = useState(() => userPresets.some((p) => p.id === selectedId));
  const used = useMemo(() => {
    const ids = new Set(presets.map((p) => p.categoryId));
    return categories.filter((c) => ids.has(c.id));
  }, [presets, categories]);

  const current = used.find((c) => c.id === categoryId) ?? used[0];
  const groupOf = (c: StudioCategory | undefined) =>
    GROUPS.find((g) => c && (g.groups as readonly string[]).includes(c.groupId))?.id ?? "voz";
  const activeGroup = favMode ? "fav" : groupOf(current);
  const groupCats = favMode ? [] : used.filter((c) => groupOf(c) === activeGroup);
  const visible = favMode ? presets.filter((p) => favorites.has(p.id)) : presets.filter((p) => p.categoryId === current?.id);

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-4 gap-1 rounded-2xl border border-border p-1 text-xs sm:text-sm" role="tablist" aria-label="Tipo de som">
        {GROUPS.map((g) => {
          const first = used.find((c) => groupOf(c) === g.id);
          return (
            <button
              key={g.id}
              role="tab"
              aria-selected={activeGroup === g.id}
              disabled={!first}
              onClick={() => {
                setFavMode(false);
                if (first) onCategory(first.id);
              }}
              className={cn(
                "rounded-xl py-2 font-medium transition disabled:opacity-40",
                activeGroup === g.id ? "bg-brand text-white" : "text-muted hover:text-text",
              )}
            >
              {g.label}
            </button>
          );
        })}
        <button
          role="tab"
          aria-selected={favMode}
          onClick={() => setFavMode(true)}
          className={cn(
            "flex items-center justify-center gap-1 rounded-xl py-2 font-medium transition",
            favMode ? "bg-brand text-white" : "text-muted hover:text-text",
          )}
        >
          <Star className="size-3.5" aria-hidden /> Meus
        </button>
      </div>

      {favMode && userPresets.length > 0 && (
        <>
          <p className="text-xs font-medium uppercase tracking-wider text-muted">Meus presets</p>
          <ul className="grid gap-2 sm:grid-cols-2">
            {userPresets.map((p) => (
              <PresetItem
                key={p.id}
                preset={p}
                selected={p.id === selectedId}
                onSelect={onSelect}
                action={
                  <button
                    onClick={() => onDeleteUserPreset(p)}
                    aria-label={`Apagar ${p.name}`}
                    className="m-1.5 rounded-full p-2 text-subtle hover:bg-white/5 hover:text-red-300"
                  >
                    <Trash2 className="size-4" />
                  </button>
                }
              />
            ))}
          </ul>
          {visible.length > 0 && <p className="text-xs font-medium uppercase tracking-wider text-muted">Favoritos</p>}
        </>
      )}

      {favMode && visible.length === 0 && userPresets.length === 0 && (
        <p className="rounded-2xl border border-dashed border-border p-4 text-center text-sm text-muted">
          Aqui ficam os presets que você criar em “Personalizar” e os que você marcar com a estrela. Tudo salvo na sua conta.
        </p>
      )}

      {groupCats.length > 1 && (
        <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1" aria-label="Categorias">
          {groupCats.map((c) => (
            <Chip key={c.id} active={current?.id === c.id} onClick={() => onCategory(c.id)}>
              {c.name}
            </Chip>
          ))}
        </div>
      )}

      <ul className="grid gap-2 sm:grid-cols-2">
        {visible.map((p) => (
          <PresetItem
            key={p.id}
            preset={p}
            selected={p.id === selectedId}
            onSelect={onSelect}
            action={
              <button
                onClick={() => onToggleFavorite(p)}
                aria-label={favorites.has(p.id) ? `Remover ${p.name} dos favoritos` : `Favoritar ${p.name}`}
                aria-pressed={favorites.has(p.id)}
                className="m-1.5 rounded-full p-2 text-subtle hover:bg-white/5 hover:text-amber-300"
              >
                <Star className={cn("size-4", favorites.has(p.id) && "fill-amber-300 text-amber-300")} />
              </button>
            }
          />
        ))}
      </ul>
    </div>
  );
}

function PresetItem({
  preset: p,
  selected,
  onSelect,
  action,
}: {
  preset: StudioPreset;
  selected: boolean;
  onSelect: (p: StudioPreset) => void;
  action: React.ReactNode;
}) {
  return (
    <li
      className={cn(
        "flex h-full items-start rounded-2xl border transition",
        selected ? "border-violet-400 bg-primary/12 shadow-[0_0_0_1px] shadow-violet-400/40" : "border-border hover:bg-white/[0.04]",
      )}
    >
      <button onClick={() => onSelect(p)} aria-pressed={selected} className="flex min-w-0 flex-1 items-start gap-3 p-3 text-left">
        <span
          className={cn(
            "grid size-10 shrink-0 place-items-center rounded-xl bg-gradient-to-br to-transparent text-white",
            p.userPresetId ? "from-fuchsia-500/60" : (STYLE_HUE[p.style ?? ""] ?? "from-violet-500/50"),
          )}
          aria-hidden
        >
          {selected ? <Check className="size-5" /> : <span className="text-xs font-semibold uppercase">{p.name.slice(0, 2)}</span>}
        </span>
        <span className="min-w-0">
          <span className="block text-sm font-semibold">{p.name}</span>
          <span className="line-clamp-2 text-xs text-muted">{p.description}</span>
        </span>
      </button>
      {action}
    </li>
  );
}
