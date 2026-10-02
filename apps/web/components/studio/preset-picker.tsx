"use client";

import { useMemo, useState } from "react";
import { Check, Share2, SlidersHorizontal, Star, Trash2 } from "lucide-react";
import { Chip } from "@/components/ui/misc";
import { cn } from "@/lib/cn";
import type { StudioCategory, StudioPreset } from "@/lib/presets";
import { INSTRUMENTS, SOUND_TABS, instrumentOf, tabOfCategory, type Instrument, type SoundTab } from "@/lib/mix";

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
  /** Ordem das abas definida no admin. */
  tabs: SoundTab[];
  categoryId: string | null;
  onCategory: (id: string) => void;
  selectedId: string | null;
  onSelect: (p: StudioPreset) => void;
  favorites: Set<string>;
  onToggleFavorite: (p: StudioPreset) => void;
  /** Presets personalizados do usuário (aba "Meus"). */
  userPresets: StudioPreset[];
  onDeleteUserPreset: (p: StudioPreset) => void;
  onShareUserPreset: (p: StudioPreset) => void;
  /** "Personalizar do zero": base com todos os módulos para o usuário montar. */
  onStartFromScratch: (kind: Instrument | "voz", categoryId: string) => void;
  /** Conteúdo da aba Amplificadores. */
  ampTab: React.ReactNode;
};

const INSTRUMENT_HINT: Record<Instrument, string> = {
  drums: "O preset escolhe os samples pelo estilo, equaliza, comprime e põe o reverb no fim. Tudo ajustável depois.",
  guitar: "O preset vem com amplificador (quando faz sentido), equalização, compressão e reverb no fim. Tudo ajustável depois.",
  bass: "O preset vem com amplificador (quando faz sentido), equalização, compressão e reverb no fim. Tudo ajustável depois.",
  acoustic: "O preset vem com equalização, compressão e reverb no fim, para celular, microfone ou violão plugado. Tudo ajustável depois.",
  piano: "O preset vem com equalização, compressão e reverb no fim. Tudo ajustável depois.",
};

const SCRATCH_HINT: Record<Instrument, string> = {
  drums: "Samples de estúdio para bumbo, caixa e tons, compressão e reverb já no lugar. Você escolhe cada sample e ajusta tudo.",
  guitar: "Amplificador (opcional: dá para tirar), equalização, compressão e reverb no fim, com valores neutros. Você ajusta tudo.",
  bass: "Amplificador (opcional: dá para tirar), equalização e compressão, com valores neutros. Você ajusta tudo.",
  acoustic: "Equalização, compressão e reverb no fim, com valores neutros. Você ajusta tudo e salva como seu.",
  piano: "Equalização, compressão e reverb no fim, com valores neutros. Você ajusta tudo e salva como seu.",
};

export function PresetPicker({
  presets,
  categories,
  tabs,
  categoryId,
  onCategory,
  selectedId,
  onSelect,
  favorites,
  onToggleFavorite,
  userPresets,
  onDeleteUserPreset,
  onShareUserPreset,
  onStartFromScratch,
  ampTab,
}: Props) {
  const used = useMemo(() => {
    const ids = new Set(presets.map((p) => p.categoryId));
    return categories.filter((c) => ids.has(c.id));
  }, [presets, categories]);
  const current = used.find((c) => c.id === categoryId) ?? categories.find((c) => c.id === categoryId) ?? used[0];

  // aba e instrumento abertos: começam no som em uso (o preset do usuário abre em "Meus")
  const [tab, setTab] = useState<SoundTab | "meus">(() => (userPresets.some((p) => p.id === selectedId) ? "meus" : tabOfCategory(current)));
  const [instrument, setInstrument] = useState<Instrument>(() => instrumentOf(current) ?? "drums");
  const [mode, setMode] = useState<"preset" | "zero">(() => (selectedId?.startsWith("tpl-") ? "zero" : "preset"));

  const catsOf = (groups: readonly string[]) => used.filter((c) => groups.includes(c.groupId));
  const instruments = INSTRUMENTS.filter((i) => used.some((c) => c.groupId === i.id));
  const tabCats = tab === "instrumentos" ? catsOf([instrument]) : tab === "voz" || tab === "musica" ? catsOf(SOUND_TABS[tab].groups) : [];
  const shownCat = tabCats.find((c) => c.id === current?.id) ?? tabCats[0];
  const list = tab === "meus" ? presets.filter((p) => favorites.has(p.id)) : presets.filter((p) => p.categoryId === shownCat?.id);
  const visibleTabs = tabs.filter((t) => t === "amplificadores" || catsOf(SOUND_TABS[t].groups).length > 0);
  const instrumentLabel = INSTRUMENTS.find((i) => i.id === instrument)?.label.toLowerCase() ?? "";

  const favButton = (p: StudioPreset) => (
    <button
      onClick={() => onToggleFavorite(p)}
      aria-label={favorites.has(p.id) ? `Remover ${p.name} dos favoritos` : `Favoritar ${p.name}`}
      aria-pressed={favorites.has(p.id)}
      className="m-1.5 rounded-full p-2 text-subtle hover:bg-white/5 hover:text-amber-300"
    >
      <Star className={cn("size-4", favorites.has(p.id) && "fill-amber-300 text-amber-300")} />
    </button>
  );
  const catChips = tabCats.length > 1 && (
    <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1" aria-label="Categorias">
      {tabCats.map((c) => (
        <Chip key={c.id} active={shownCat?.id === c.id} onClick={() => onCategory(c.id)}>
          {c.name}
        </Chip>
      ))}
    </div>
  );
  const presetList = (
    <ul className="grid gap-2 sm:grid-cols-2">
      {list.map((p) => (
        <PresetItem key={p.id} preset={p} selected={p.id === selectedId} onSelect={onSelect} action={favButton(p)} />
      ))}
    </ul>
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="-mx-1 flex gap-1 overflow-x-auto rounded-2xl border border-border p-1 text-xs sm:text-sm" role="tablist" aria-label="Tipo de som">
        {[...visibleTabs, "meus" as const].map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={cn(
              "flex shrink-0 grow items-center justify-center gap-1 whitespace-nowrap rounded-xl px-3 py-2 font-medium transition",
              tab === t ? "bg-brand text-white" : "text-muted hover:text-text",
            )}
          >
            {t === "meus" ? (
              <>
                <Star className="size-3.5" aria-hidden /> Meus
              </>
            ) : (
              SOUND_TABS[t].label
            )}
          </button>
        ))}
      </div>

      {tab === "voz" && (
        <>
          {catChips}
          {presetList}
          <ScratchCard
            title="Personalizar a voz do zero"
            text="EQ, compressão e reverb já no lugar, com valores neutros: você ajusta tudo e salva como seu."
            onClick={() => onStartFromScratch("voz", shownCat?.id ?? "vocal-pop")}
          />
        </>
      )}

      {tab === "instrumentos" && (
        <>
          <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1" aria-label="Instrumento">
            {instruments.map((i) => (
              <Chip key={i.id} active={instrument === i.id} onClick={() => setInstrument(i.id)}>
                {i.label}
              </Chip>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-1 rounded-2xl border border-border p-1 text-sm" role="tablist" aria-label="Como mixar">
            {(
              [
                ["preset", "Usar um preset"],
                ["zero", "Personalizar do zero"],
              ] as const
            ).map(([m, label]) => (
              <button
                key={m}
                role="tab"
                aria-selected={mode === m}
                onClick={() => setMode(m)}
                className={cn("rounded-xl py-2 font-medium", mode === m ? "bg-white/12 text-text" : "text-muted hover:text-text")}
              >
                {label}
              </button>
            ))}
          </div>
          {mode === "preset" ? (
            <>
              <p className="text-xs text-muted">{INSTRUMENT_HINT[instrument]}</p>
              {catChips}
              {presetList}
            </>
          ) : (
            <ScratchCard
              title={`Começar minha mixagem de ${instrumentLabel}`}
              text={SCRATCH_HINT[instrument]}
              onClick={() => onStartFromScratch(instrument, catsOf([instrument])[0]?.id ?? "")}
            />
          )}
        </>
      )}

      {tab === "amplificadores" && ampTab}

      {tab === "musica" && (
        <>
          <p className="text-xs text-muted">Para música já mixada: masterização (volume, brilho e punch no padrão das plataformas).</p>
          {catChips}
          {presetList}
        </>
      )}

      {tab === "meus" && (
        <>
          {userPresets.length > 0 && (
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
                      !p.userPresetId ? null : (
                        <span className="flex flex-col">
                          <button
                            onClick={() => onShareUserPreset(p)}
                            aria-label={`Compartilhar ${p.name}`}
                            className="m-1.5 mb-0 rounded-full p-2 text-subtle hover:bg-white/5 hover:text-violet-200"
                          >
                            <Share2 className="size-4" />
                          </button>
                          <button
                            onClick={() => onDeleteUserPreset(p)}
                            aria-label={`Apagar ${p.name}`}
                            className="m-1.5 rounded-full p-2 text-subtle hover:bg-white/5 hover:text-red-300"
                          >
                            <Trash2 className="size-4" />
                          </button>
                        </span>
                      )
                    }
                  />
                ))}
              </ul>
            </>
          )}
          {list.length > 0 && <p className="text-xs font-medium uppercase tracking-wider text-muted">Favoritos</p>}
          {presetList}
          {list.length === 0 && userPresets.length === 0 && (
            <p className="rounded-2xl border border-dashed border-border p-4 text-center text-sm text-muted">
              Aqui ficam os presets que você criar e os que você marcar com a estrela. Tudo salvo na sua conta.
            </p>
          )}
        </>
      )}
    </div>
  );
}

function ScratchCard({ title, text, onClick }: { title: string; text: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-3 rounded-2xl border border-dashed border-violet-400/50 p-3 text-left hover:bg-primary/10"
    >
      <span className="bg-brand grid size-10 shrink-0 place-items-center rounded-xl text-white">
        <SlidersHorizontal className="size-5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold">{title}</span>
        <span className="block text-xs text-muted">{text}</span>
      </span>
    </button>
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
