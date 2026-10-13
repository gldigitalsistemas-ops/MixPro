"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AudioLines, ChevronRight, Mic2, Sliders, Sparkles, UserRound, Wand2 } from "lucide-react";
import { DEFAULT_PREMIUM, parsePremium, type PremiumCatalog, type PremiumId } from "@mixpro/contracts";
import { Card } from "@/components/ui/card";
import { supabaseBrowser } from "@/lib/supabase/client";
import { brl } from "@/lib/premium/client";
import { DevBadge } from "./explainer";
import { ShowcaseStrip } from "./showcase";

/** Catálogo público (preços do Admin), para quem ainda nem entrou na conta. */
export function usePublicCatalog(): PremiumCatalog {
  const [cat, setCat] = useState<PremiumCatalog>(DEFAULT_PREMIUM);
  useEffect(() => {
    void supabaseBrowser()
      .from("system_settings")
      .select("value")
      .eq("key", "premium_products")
      .maybeSingle()
      .then(({ data }) => data && setCat(parsePremium(data.value)));
  }, []);
  return cat;
}

export function Price({ cat, id }: { cat: PremiumCatalog; id: PremiumId }) {
  const it = cat.items.find((i) => i.id === id);
  if (!it) return null;
  if (!it.enabled) return <span className="rounded-full bg-amber-400/15 px-2.5 py-0.5 text-xs font-semibold text-amber-200">Em breve</span>;
  return (
    <span className="flex flex-wrap items-baseline gap-2 text-sm">
      {it.intro_brl !== null ? (
        <>
          <span className="text-muted line-through">{brl(it.price_brl)}</span>
          <strong className="font-display text-lg text-emerald-300">{brl(it.intro_brl)}</strong>
          <span className="text-[11px] text-emerald-200">na 1ª vez</span>
        </>
      ) : (
        <strong className="font-display text-lg">{brl(it.price_brl)}</strong>
      )}
    </span>
  );
}

const CARDS: { href: string; id?: PremiumId; icon: typeof Wand2; title: string; text: string; send: string; get: string }[] = [
  { href: "/mixar", id: "mix_ia", icon: Sliders, title: "Mix & Master IA", text: "Suas pistas mixadas e masterizadas como num estúdio, com mixer para ajustar.", send: "As pistas do projeto (WAV)", get: "Música pronta para o Spotify + pistas tratadas" },
  { href: "/produzir", id: "producao", icon: Mic2, title: "Produza sua composição", text: "Da guia (voz e violão) à música produzida, com a sua voz afinada e mixada.", send: "A guia + uma referência", get: "3 versões da base, cifra, clique e a música final" },
  { href: "/vs?premium=1", id: "vs_premium", icon: AudioLines, title: "VS Premium 7 faixas", text: "Separação de estúdio: voz, bateria, baixo, guitarra, violão, teclado e outros.", send: "Uma música", get: "7 faixas + clique, para tocar ao vivo" },
  { href: "/mixagem-profissional", icon: UserRound, title: "Mixagem por engenheiro", text: "Um engenheiro de áudio mixa a sua música à mão, com revisões.", send: "As pistas (pelo app)", get: "Mixagem humana com prazo e revisões" },
];

export function ProductionHub() {
  const cat = usePublicCatalog();
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="font-display text-3xl font-bold tracking-tight md:text-4xl">Produção</h1>
          <DevBadge />
        </div>
        <p className="mt-2 max-w-2xl text-muted">
          Os recursos profissionais do Mix Pro: mixar o seu projeto, produzir a sua composição e separar faixas com qualidade de estúdio. Em todos você ouve uma
          prévia grátis antes de pagar.
        </p>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        {CARDS.map((c) => (
          <Link key={c.href} href={c.href} className="group">
            <Card className="flex h-full flex-col gap-3 p-5 transition group-hover:border-violet-400/50">
              <div className="flex items-start gap-3">
                <span className="bg-brand grid size-11 shrink-0 place-items-center rounded-2xl text-white">
                  <c.icon className="size-5" aria-hidden />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="font-display text-lg font-semibold">{c.title}</p>
                  <p className="text-sm text-muted">{c.text}</p>
                </div>
                <ChevronRight className="size-5 text-muted transition group-hover:translate-x-0.5" aria-hidden />
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <span className="rounded-xl bg-white/5 p-2">
                  <span className="block text-subtle">Você envia</span>
                  {c.send}
                </span>
                <span className="rounded-xl bg-white/5 p-2">
                  <span className="block text-subtle">Você recebe</span>
                  {c.get}
                </span>
              </div>
              {c.id ? <Price cat={cat} id={c.id} /> : <span className="text-sm text-muted">Preço na página</span>}
            </Card>
          </Link>
        ))}
      </div>
      <p className="flex items-center gap-2 text-sm text-muted">
        <Sparkles className="size-4 text-amber-300" aria-hidden /> No Plano Pro: {cat.pro_discount_pct}% de desconto nos recursos de produção, WAV 24 bits/FLAC e prioridade na fila.
      </p>
      <ShowcaseStrip title="Ouça o antes e depois de quem já usou" />
    </div>
  );
}
