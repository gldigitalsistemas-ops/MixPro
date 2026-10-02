"use client";

import { supabaseBrowser } from "@/lib/supabase/client";

export type TrackEvent =
  | "studio_open"
  | "file_loaded"
  | "captions_generated"
  | "export"
  | "share"
  | "checkout_start"
  | "tour_done"
  | "style_saved"
  | "preset_saved"
  | "preset_shared"
  | "shared_preset_opened"
  | "kit_unlocked"
  | "batch_export"
  | "vs_separated"
  | "vs_download";

/** Registra um uso (para o painel do admin). Nunca atrapalha o usuário: erros são ignorados. */
export function track(event: TrackEvent, props: Record<string, string | number | boolean> = {}) {
  try {
    void supabaseBrowser()
      .rpc("track_event", { p_event: event, p_props: props })
      .then(
        () => {},
        () => {},
      );
  } catch {
    // sem Supabase configurado (dev) — segue sem registrar
  }
}
