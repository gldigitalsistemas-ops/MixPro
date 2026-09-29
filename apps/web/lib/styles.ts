"use client";

import { supabaseBrowser } from "@/lib/supabase/client";

/** Configurações salvas em "Meu estilo" (tudo opcional: aplica só o que existir). */
export type StyleSettings = {
  presetSlug?: string;
  intensity?: number;
  noise?: "off" | "light" | "strong";
  social?: boolean;
  captionStyle?: string;
  captionPosition?: string;
  format?: string;
  fit?: string;
  cutSilence?: string;
  watermark?: boolean;
};

export type SavedStyle = { id: string; name: string; settings: StyleSettings };

export async function listStyles(): Promise<SavedStyle[]> {
  const { data, error } = await supabaseBrowser().from("user_styles").select("id, name, settings").order("created_at");
  if (error) throw error;
  return (data ?? []) as SavedStyle[];
}

export async function saveStyle(userId: string, name: string, settings: StyleSettings): Promise<void> {
  const { error } = await supabaseBrowser()
    .from("user_styles")
    .upsert({ user_id: userId, name: name.trim().slice(0, 40), settings }, { onConflict: "user_id,name" });
  if (error) throw error;
}

export async function deleteStyle(id: string): Promise<void> {
  await supabaseBrowser().from("user_styles").delete().eq("id", id);
}
