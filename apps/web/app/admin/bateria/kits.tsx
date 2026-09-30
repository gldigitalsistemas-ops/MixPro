"use client";

import { useCallback, useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/toast";
import type { DrumSlot } from "@/lib/dsp/drums/studio";
import { fetchDrumKits, fetchDrumLibrary, KIT_FIELD, optionsFor, SLOT_LABEL, type DrumKit, type DrumLibraryItem } from "@/lib/drums/library";
import { supabaseBrowser } from "@/lib/supabase/client";
import { cn } from "@/lib/cn";

const SLOTS: DrumSlot[] = ["kick", "snare", "rimshot", "tom1", "tom2", "floor"];
const STYLES = ["worship", "poprock", "reggae", "groove", "soul", "gospel", "sertanejo"];
const STYLE_LABEL: Record<string, string> = {
  worship: "Worship",
  poprock: "Pop Rock",
  reggae: "Reggae",
  groove: "Groove",
  soul: "Soul",
  gospel: "Gospel",
  sertanejo: "Sertanejo",
};
const input = "h-9 w-full rounded-lg border border-border-strong bg-black/20 px-2 text-sm outline-none focus:border-violet-400";

/** Kits: o usuário escolhe um conjunto de peças com um toque. Preço > 0 = premium (desbloqueio com créditos). */
export function KitManager() {
  const toast = useToast();
  const sb = supabaseBrowser();
  const [kits, setKits] = useState<DrumKit[] | null>(null);
  const [library, setLibrary] = useState<DrumLibraryItem[]>([]);

  const reload = useCallback(
    () =>
      Promise.all([fetchDrumKits(true), fetchDrumLibrary(true).catch(() => [])]).then(([k, l]) => {
        setKits(k);
        setLibrary(l);
      }),
    [],
  );
  useEffect(() => {
    void reload();
  }, [reload]);

  async function create() {
    const pick = (slot: DrumSlot) => optionsFor(slot, library)[slot === "tom2" ? 1 : 0]?.id ?? null;
    const { error } = await sb.from("drum_kits").insert({
      name: `Kit ${(kits?.length ?? 0) + 1}`,
      position: (kits?.length ?? 0) + 1,
      ...Object.fromEntries(SLOTS.map((s) => [KIT_FIELD[s], pick(s)])),
    });
    if (error) return toast.error("Não foi possível criar. A migração 20261001000005 já foi rodada no Supabase?");
    await reload();
  }

  async function update(kit: DrumKit, patch: Partial<DrumKit>) {
    setKits((list) => list?.map((k) => (k.id === kit.id ? { ...k, ...patch } : k)) ?? null);
    const { error } = await sb.from("drum_kits").update(patch).eq("id", kit.id);
    if (error) {
      toast.error("Não foi possível salvar.");
      void reload();
    }
  }

  async function remove(kit: DrumKit) {
    if (!confirm(`Apagar o kit “${kit.name}”? Os samples continuam na biblioteca.`)) return;
    const { error } = await sb.from("drum_kits").delete().eq("id", kit.id);
    if (error) return toast.error("Não foi possível apagar (quem já desbloqueou o kit perde o registro; oculte em vez de apagar).");
    setKits((list) => list?.filter((k) => k.id !== kit.id) ?? null);
  }

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-xl font-semibold">Kits</h2>
          <p className="text-sm text-muted">
            Conjuntos de peças que o baterista escolhe com um toque. Com preço, o kit é premium: ouvir é livre e o usuário desbloqueia uma vez
            com créditos para baixar.
          </p>
        </div>
        <Button size="sm" onClick={create}>
          <Plus className="size-4" /> Novo kit
        </Button>
      </div>
      {kits === null ? (
        <p className="text-sm text-muted">Carregando…</p>
      ) : !kits.length ? (
        <p className="rounded-2xl border border-dashed border-border p-4 text-sm text-muted">Nenhum kit ainda. Envie os samples e crie o primeiro.</p>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {kits.map((k) => (
            <Card key={k.id} className={cn("flex flex-col gap-3 p-4", !k.active && "opacity-60")}>
              <div className="flex items-center gap-2">
                <input
                  defaultValue={k.name}
                  maxLength={60}
                  onBlur={(e) => e.target.value.trim() && e.target.value !== k.name && update(k, { name: e.target.value.trim() })}
                  aria-label="Nome do kit"
                  className="min-w-0 flex-1 rounded-lg border border-transparent bg-transparent px-1 font-medium outline-none hover:border-border focus:border-violet-400"
                />
                <Badge tone={k.price_credits > 0 ? "warning" : "success"}>{k.price_credits > 0 ? `${k.price_credits} créditos` : "Grátis"}</Badge>
                <button onClick={() => update(k, { active: !k.active })} className="rounded px-2 py-1 text-xs text-muted hover:bg-white/5 hover:text-text">
                  {k.active ? "Ocultar" : "Ativar"}
                </button>
                <button onClick={() => remove(k)} aria-label="Apagar kit" className="rounded p-1.5 text-red-300 hover:bg-danger/10">
                  <Trash2 className="size-4" />
                </button>
              </div>
              <input
                defaultValue={k.description ?? ""}
                maxLength={160}
                placeholder="Descrição curta (ex.: Maple 22/14/10/16, pele porosa, sala grande)"
                onBlur={(e) => e.target.value !== (k.description ?? "") && update(k, { description: e.target.value.trim() || null })}
                aria-label="Descrição do kit"
                className={input}
              />
              <div className="grid grid-cols-2 gap-2">
                {SLOTS.map((slot) => (
                  <label key={slot} className="flex flex-col gap-1 text-xs text-muted">
                    {SLOT_LABEL[slot]}
                    <select
                      className={input}
                      value={(k[KIT_FIELD[slot]] as string | null) ?? ""}
                      onChange={(e) => update(k, { [KIT_FIELD[slot]]: e.target.value || null } as Partial<DrumKit>)}
                    >
                      <option value="">—</option>
                      {optionsFor(slot, library).map((o) => (
                        <option key={o.id} value={o.id}>
                          {o.name}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
              </div>
              <div className="flex flex-wrap items-end gap-3">
                <label className="flex w-28 flex-col gap-1 text-xs text-muted">
                  Preço (créditos)
                  <input
                    type="number"
                    min={0}
                    max={200}
                    defaultValue={k.price_credits}
                    onBlur={(e) => {
                      const v = Math.max(0, Math.min(200, Math.round(Number(e.target.value) || 0)));
                      if (v !== k.price_credits) update(k, { price_credits: v });
                    }}
                    className={input}
                  />
                </label>
                <div className="flex flex-1 flex-wrap gap-1">
                  <span className="w-full text-xs text-muted">Padrão nos estilos</span>
                  {STYLES.map((s) => {
                    const on = k.styles.includes(s);
                    return (
                      <button
                        key={s}
                        type="button"
                        aria-pressed={on}
                        onClick={() => update(k, { styles: on ? k.styles.filter((x) => x !== s) : [...k.styles, s] })}
                        className={cn("rounded-full border px-2 py-0.5 text-[11px]", on ? "border-violet-400 bg-primary/20" : "border-border text-muted")}
                      >
                        {STYLE_LABEL[s]}
                      </button>
                    );
                  })}
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </section>
  );
}
