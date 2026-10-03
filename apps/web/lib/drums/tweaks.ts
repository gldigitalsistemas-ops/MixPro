/**
 * Ajustes da bateria de estúdio aplicados na cadeia (sem React nem Supabase: roda também em Node).
 * Usado pela prévia do estúdio e pelo ExportJob.
 */
import type { DrumSlot } from "@/lib/dsp/drums/studio";

/** Parâmetro do drum_studio que guarda o sample de cada peça. */
export const SLOT_PARAM: Record<DrumSlot, string> = {
  kick: "kick_sample",
  snare: "snare_sample",
  tom1: "tom1_sample",
  tom2: "tom2_sample",
  floor: "floor_sample",
  rimshot: "rimshot_sample",
};

/** Todas as peças, nesta ordem (a ordem entra no JSON da cadeia e, portanto, no p_ref). */
const ALL_SLOTS: DrumSlot[] = ["kick", "snare", "tom1", "tom2", "floor", "rimshot"];

export type DrumTweaks = {
  samples: Record<DrumSlot, string>;
  kick: number;
  snare: number;
  toms: number;
  floor: number;
  kick_tune: number;
  snare_tune: number;
  toms_tune: number;
  floor_tune: number;
  rimshot: number;
  room: number;
  sample_mix: number;
  reverb_size: string;
  reverb: number;
  /** Sensibilidade da detecção de cada peça (50 = automático). */
  kick_sens: number;
  snare_sens: number;
  tom_sens: number;
};

/** Aplica as escolhas na cadeia do preset (mantendo o resto igual). */
export function withDrumTweaks<T extends { chain: { type: string; params?: Record<string, unknown> }[] }>(doc: T, t: DrumTweaks | null): T {
  if (!t) return doc;
  return {
    ...doc,
    chain: doc.chain.map((m) =>
      m.type === "drum_studio"
        ? {
            ...m,
            params: {
              ...m.params,
              ...Object.fromEntries(ALL_SLOTS.map((s) => [SLOT_PARAM[s], t.samples[s]])),
              kick: t.kick,
              snare: t.snare,
              toms: t.toms,
              floor: t.floor,
              kick_tune: t.kick_tune,
              snare_tune: t.snare_tune,
              toms_tune: t.toms_tune,
              floor_tune: t.floor_tune,
              rimshot: t.rimshot,
              room: { value: t.room, neutral: 0 },
              sample_mix: { value: t.sample_mix, neutral: 0 },
              reverb_size: t.reverb_size,
              reverb: { value: t.reverb, neutral: 0 },
              kick_sens: t.kick_sens,
              snare_sens: t.snare_sens,
              tom_sens: t.tom_sens,
            },
          }
        : m,
    ),
  };
}
