"use client";

import { useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";

/** Plano em vigor (public.my_plan): admin, concessão com data, assinatura ou grátis. */
export type MyPlan = {
  plan: "pro" | "criador" | "free";
  source: "admin" | "grant" | "subscription" | "free";
  expires_at: string | null;
  /** Concessão que terminou nos últimos 14 dias (convite para assinar). */
  ended_plan?: "pro" | "criador";
  ended_at?: string;
};

export function useMyPlan(userId: string | null | undefined): MyPlan | null {
  const [plan, setPlan] = useState<MyPlan | null>(null);
  useEffect(() => {
    if (!userId) return;
    let alive = true;
    void supabaseBrowser()
      .rpc("my_plan")
      .then(({ data, error }) => {
        // sem a migração dos planos, nada aparece
        if (alive && !error && data) setPlan(data as MyPlan);
      });
    return () => {
      alive = false;
    };
  }, [userId]);
  return userId ? plan : null;
}
