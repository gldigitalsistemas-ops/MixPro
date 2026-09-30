"use client";

import type { ChainDoc } from "@/lib/dsp/chain";
import { supabaseBrowser } from "@/lib/supabase/client";

export type StudioPreset = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  style: string | null;
  categoryId: string;
  chain: ChainDoc;
  defaultIntensity: number;
  /** Preset salvo pelo usuário (id da tabela user_presets). */
  userPresetId?: string;
  /** Preset do catálogo em que o preset do usuário foi baseado. */
  basePresetId?: string | null;
};

export type StudioCategory = { id: string; groupId: string; name: string; position: number };

type Row = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  style: string | null;
  category_id: string;
  version: { chain: ChainDoc; default_intensity: number } | null;
};

export async function fetchPresets(): Promise<{ presets: StudioPreset[]; categories: StudioCategory[] }> {
  const sb = supabaseBrowser();
  const [p, c] = await Promise.all([
    sb
      .from("presets")
      .select(
        "id, slug, name, description, style, category_id, version:preset_versions!presets_current_version_fk(chain, default_intensity)",
      )
      .eq("active", true)
      .is("archived_at", null)
      .order("position"),
    sb.from("preset_categories").select("id, group_id, name, position").order("position"),
  ]);
  if (p.error) throw p.error;
  if (c.error) throw c.error;
  const presets = (p.data as unknown as Row[])
    .filter((r) => r.version?.chain)
    .map((r) => ({
      id: r.id,
      slug: r.slug,
      name: r.name,
      description: r.description,
      style: r.style,
      categoryId: r.category_id,
      chain: r.version!.chain,
      defaultIntensity: r.version!.default_intensity,
    }));
  const categories = (c.data ?? []).map((r) => ({
    id: r.id as string,
    groupId: r.group_id as string,
    name: r.name as string,
    position: r.position as number,
  }));
  return { presets, categories };
}
