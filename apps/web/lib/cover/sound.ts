"use client";

/**
 * Som da performance no Modo Cover: a mesma cadeia "do zero" do Estúdio para o instrumento (lib/mix.ts) e, na
 * bateria, os samples de estúdio da biblioteca no estilo escolhido. Só entram samples de kits grátis ou já
 * liberados (nada é cobrado aqui); sem eles, o timbre sintetizado do estilo.
 */
import type { ChainDoc } from "@/lib/dsp/chain";
import { DRUM_SLOTS, type DrumSampleSet, type DrumSlot } from "@/lib/dsp/drums/studio";
import { fetchDrumKits, fetchDrumLibrary, fetchUnlockedKits, KIT_FIELD, loadSampleSet, resolveSample, SLOT_PARAM } from "@/lib/drums/library";
import { starterChain, type Instrument } from "@/lib/mix";

export const DRUM_STYLES = [
  { value: "poprock", label: "Pop Rock" },
  { value: "worship", label: "Worship" },
  { value: "gospel", label: "Gospel" },
  { value: "groove", label: "Groove / Funk" },
  { value: "soul", label: "Soul / R&B" },
  { value: "sertanejo", label: "Sertanejo" },
  { value: "reggae", label: "Reggae" },
] as const;

/** Cadeia do instrumento; na bateria, o estilo, o "som de estúdio" e os samples escolhidos. */
export function coverChain(kind: Instrument | "voz", opts: { kit?: string; studio?: number; samples?: Partial<Record<DrumSlot, string>> } = {}): ChainDoc {
  const doc = starterChain(kind);
  if (kind !== "drums") return doc;
  return {
    ...doc,
    chain: doc.chain.map((m) =>
      m.type === "drum_studio"
        ? {
            ...m,
            params: {
              ...m.params,
              kit: opts.kit ?? "poprock",
              sample_mix: opts.studio ?? 60,
              ...Object.fromEntries(Object.entries(opts.samples ?? {}).map(([slot, id]) => [SLOT_PARAM[slot as DrumSlot], id])),
            },
          }
        : m,
    ),
  };
}

/** Samples do estilo (só de kits grátis/liberados) e as escolhas por peça. */
export async function drumSound(kit: string, sampleRate: number): Promise<{ set: DrumSampleSet; choices: Partial<Record<DrumSlot, string>> }> {
  try {
    const [library, kits, unlocked] = await Promise.all([fetchDrumLibrary(), fetchDrumKits(), fetchUnlockedKits().catch(() => new Set<string>())]);
    const choices: Partial<Record<DrumSlot, string>> = {};
    for (const slot of DRUM_SLOTS) {
      let id = resolveSample(slot, "", kit, library);
      // sample que só existe em kit pago não liberado: fica o sintetizado
      const inKits = kits.filter((k) => k[KIT_FIELD[slot]] === id);
      if (inKits.length && inKits.every((k) => k.price_credits > 0 && !unlocked.has(k.id))) id = "synth";
      choices[slot] = id;
    }
    return { set: await loadSampleSet(choices, library, sampleRate), choices };
  } catch {
    return { set: {}, choices: {} };
  }
}
