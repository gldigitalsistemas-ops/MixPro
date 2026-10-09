/**
 * Edição salva no aparelho (IndexedDB, lib/session-store): o formato gravado e como ele volta.
 * Funções puras, sem React. Só o que define o som (o app trata áudio; o vídeo é só o contêiner).
 * Sessões antigas, com legendas e ferramentas de vídeo, continuam abrindo: esses campos são ignorados.
 */
import { DELIVERY_IDS } from "@mixpro/contracts";
import type { ChainDoc } from "@/lib/dsp/chain";
import type { DrumTweaks } from "@/lib/drums/tweaks";
import type { StudioPreset } from "@/lib/presets";
import type { ReverbTweak } from "@/lib/reverb-tweak";

/** Tudo o que a edição grava. Os nomes das chaves são os de sempre (não renomeie). */
export type EditSnapshot<Noise extends string = string> = {
  preset: StudioPreset | null;
  categoryId: string | null;
  intensity: number | null;
  noise: Noise | null;
  social: boolean;
  /** Destino do ajuste final de volume; ausente = padrão. */
  delivery?: string;
  drumTweaks: DrumTweaks | null;
  reverbTweak: ReverbTweak | null;
  custom: { presetId: string; chain: ChainDoc } | null;
  masterId: string | null;
  autoDecision: "aceito" | "manual" | null;
};

/** O que vai para o aparelho. */
export function editSnapshot<S extends EditSnapshot>(e: S): S {
  return { ...e };
}

/**
 * O que restaurar de um registro salvo: só as chaves presentes (as ausentes não mudam nada).
 * `social` e `delivery` só voltam com o tipo e o valor certos.
 */
export function restorePatch(r: Record<string, unknown>): Partial<EditSnapshot> {
  const out: Record<string, unknown> = {};
  for (const k of ["preset", "categoryId", "intensity", "noise", "drumTweaks", "reverbTweak", "custom", "masterId", "autoDecision"])
    if (k in r && r[k] !== undefined) out[k] = r[k];
  if (typeof r.social === "boolean") out.social = r.social;
  if (typeof r.delivery === "string" && (DELIVERY_IDS as readonly string[]).includes(r.delivery)) out.delivery = r.delivery;
  return out as Partial<EditSnapshot>;
}
