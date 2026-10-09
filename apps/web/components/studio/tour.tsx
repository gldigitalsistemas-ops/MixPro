"use client";

import { useState } from "react";
import { Download, Headphones, SlidersHorizontal, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { track } from "@/lib/track";

const KEY = "mixpro.tour.v1";

const TIPS = [
  {
    icon: Headphones,
    title: "Ouça antes de tudo",
    text: "Toque em ▶ no player e alterne entre Antes e Depois enquanto ouve. Cada preset que você tocar já aparece na prévia, na hora.",
  },
  {
    icon: SlidersHorizontal,
    title: "Teste à vontade",
    text: "Troque o preset, a intensidade, o ruído e o volume final. Nada é gerado nem cobrado enquanto você testa.",
  },
  {
    icon: Download,
    title: "Gere só no final",
    text: "Quando estiver do seu jeito, vá em Baixar e gere o arquivo final com tudo aplicado, pronto para postar.",
  },
];

/** Três dicas na primeira vez que a pessoa abre um arquivo no estúdio. */
export function StudioTour() {
  // só aparece depois que um arquivo é aberto (nunca no HTML do servidor), então pode ler o localStorage aqui
  const [step, setStep] = useState<number | null>(() => {
    try {
      return localStorage.getItem(KEY) ? null : 0;
    } catch {
      return null; // sem armazenamento (aba anônima): não mostra
    }
  });

  if (step === null) return null;

  const finish = (completed: boolean) => {
    try {
      localStorage.setItem(KEY, "1");
    } catch {}
    if (completed) track("tour_done");
    setStep(null);
  };
  const tip = TIPS[step];
  const Icon = tip.icon;
  const last = step === TIPS.length - 1;

  return (
    <div
      role="dialog"
      aria-modal="false"
      aria-label="Dicas rápidas"
      className="fixed inset-x-3 bottom-[calc(5.5rem+env(safe-area-inset-bottom))] z-50 mx-auto max-w-md md:bottom-6"
    >
      <div className="glass flex flex-col gap-3 rounded-3xl border border-violet-400/40 p-4 shadow-[0_20px_60px_-10px_rgb(0_0_0/0.8)]">
        <div className="flex items-start gap-3">
          <span className="bg-brand grid size-10 shrink-0 place-items-center rounded-2xl text-white">
            <Icon className="size-5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] text-muted">
              Dica {step + 1} de {TIPS.length}
            </p>
            <p className="font-display font-semibold">{tip.title}</p>
            <p className="mt-1 text-sm text-muted">{tip.text}</p>
          </div>
          <button type="button" onClick={() => finish(false)} aria-label="Fechar dicas" className="text-muted hover:text-text">
            <X className="size-4" />
          </button>
        </div>
        <div className="flex items-center justify-between">
          <span className="flex gap-1.5" aria-hidden>
            {TIPS.map((_, i) => (
              <span key={i} className={i === step ? "bg-brand h-1.5 w-5 rounded-full" : "h-1.5 w-1.5 rounded-full bg-white/20"} />
            ))}
          </span>
          <Button size="sm" onClick={() => (last ? finish(true) : setStep(step + 1))}>
            {last ? "Entendi" : "Próxima"}
          </Button>
        </div>
      </div>
    </div>
  );
}
