"use client";

import Link from "next/link";
import { useState } from "react";
import { Crown, X } from "lucide-react";
import { formatDate } from "@/lib/cn";
import type { MyPlan } from "./use-my-plan";

const NAMES = { pro: "Pro", criador: "Criador" } as const;

/** Convite para assinar quando o plano concedido pelo admin termina (some ao fechar, por concessão). */
export function PlanEndedBanner({ plan }: { plan: MyPlan | null }) {
  const key = plan?.ended_at ? `mixpro.plano-terminou.${plan.ended_at}` : "";
  const [hidden, setHidden] = useState(() => {
    try {
      return typeof window !== "undefined" && Boolean(key) && localStorage.getItem(key) === "1";
    } catch {
      return false;
    }
  });
  if (!plan?.ended_plan || !plan.ended_at || hidden) return null;
  return (
    <div className="mb-4 flex items-start gap-3 rounded-2xl border border-amber-400/40 bg-amber-400/10 p-3 text-sm">
      <Crown className="mt-0.5 size-5 shrink-0 text-amber-300" aria-hidden />
      <p className="flex-1">
        O seu Plano {NAMES[plan.ended_plan]} de cortesia terminou em {formatDate(plan.ended_at)}. Gostou? Assine para continuar com todos os
        recursos.{" "}
        <Link href="/creditos" className="font-semibold text-amber-200 underline">
          Ver planos
        </Link>
      </p>
      <button
        type="button"
        aria-label="Fechar"
        onClick={() => {
          try {
            localStorage.setItem(key, "1");
          } catch {}
          setHidden(true);
        }}
        className="text-muted hover:text-text"
      >
        <X className="size-4" />
      </button>
    </div>
  );
}
