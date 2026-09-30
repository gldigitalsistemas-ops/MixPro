"use client";

import { MODULES, presetChainSchema, resolveParam, type ModuleType, type NumberParam, type ParamSpec } from "@mixpro/contracts";
import type { ChainDoc } from "@/lib/dsp/chain";
import type { StudioPreset } from "@/lib/presets";
import { supabaseBrowser } from "@/lib/supabase/client";

type Row = { id: string; name: string; category_id: string; base_preset_id: string | null; chain: ChainDoc; default_intensity: number };

export const toStudioPreset = (r: Row): StudioPreset => ({
  id: `u-${r.id}`,
  slug: `meu-${r.id.slice(0, 8)}`,
  name: r.name,
  description: "Preset personalizado por você",
  style: null,
  categoryId: r.category_id,
  chain: r.chain,
  defaultIntensity: r.default_intensity,
  userPresetId: r.id,
  basePresetId: r.base_preset_id,
});

export async function listUserPresets(): Promise<StudioPreset[]> {
  const { data, error } = await supabaseBrowser()
    .from("user_presets")
    .select("id, name, category_id, base_preset_id, chain, default_intensity")
    .order("created_at");
  if (error) throw error;
  return ((data ?? []) as Row[]).map(toStudioPreset);
}

export class PresetLimitError extends Error {}

/** Salva (ou atualiza, se já existir um com o mesmo nome) na conta do usuário. */
export async function saveUserPreset(p: { name: string; categoryId: string; basePresetId: string | null; chain: ChainDoc }): Promise<StudioPreset> {
  const sb = supabaseBrowser();
  const { data: auth } = await sb.auth.getUser();
  if (!auth.user) throw new Error("sem login");
  const chain = presetChainSchema.parse(p.chain);
  const { data, error } = await sb
    .from("user_presets")
    .upsert(
      {
        user_id: auth.user.id,
        name: p.name,
        category_id: p.categoryId,
        base_preset_id: p.basePresetId,
        chain,
        default_intensity: 100,
      },
      { onConflict: "user_id,name" },
    )
    .select("id, name, category_id, base_preset_id, chain, default_intensity")
    .single();
  if (error) throw error.message.includes("LIMITE_PRESETS") ? new PresetLimitError() : error;
  return toStudioPreset(data as Row);
}

export async function deleteUserPreset(userPresetId: string) {
  const { error } = await supabaseBrowser().from("user_presets").delete().eq("id", userPresetId);
  if (error) throw error;
}

/**
 * "Congela" a cadeia na intensidade escolhida: cada ajuste vira um número fixo, que é o que o
 * usuário ouviu. Assim o que ele mexe no editor é exatamente o que vai para o arquivo.
 */
export function freezeChain(doc: ChainDoc, intensity: number): ChainDoc {
  return {
    schema_version: 1,
    chain: doc.chain.map((m) => {
      const spec = MODULES[m.type as ModuleType];
      if (!spec) return m;
      const params: Record<string, unknown> = {};
      for (const [name, p] of Object.entries(spec.params) as [string, ParamSpec][]) {
        const raw = m.params?.[name];
        if (p.kind !== "number") params[name] = raw ?? p.default;
        else {
          const v = resolveParam(raw as number | { value: number; neutral?: number } | undefined, p as NumberParam, intensity);
          params[name] = Math.round(Math.min(p.max, Math.max(p.min, v)) * 100) / 100;
        }
      }
      return { ...m, params };
    }),
  };
}
