"use client";

import { useState } from "react";
import { CheckCircle2, ChevronDown, Clock, FlaskConical, Inbox, Send } from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/cn";
import { SupportLink } from "@/components/support/support-link";

/** Selo dos recursos novos: abertos a todos, ainda sendo afinados. */
export function DevBadge({ className }: { className?: string }) {
  return (
    <span
      title="Recurso novo, aberto a todos e ainda sendo afinado. Se algo não sair como esperado, fale com a gente: refazemos."
      className={cn("inline-flex items-center gap-1 rounded-full border border-amber-400/40 bg-amber-400/10 px-2.5 py-0.5 text-[11px] font-semibold text-amber-200", className)}
    >
      <FlaskConical className="size-3" aria-hidden /> Em desenvolvimento
    </span>
  );
}

export type ExplainerProps = {
  title: string;
  tagline: string;
  /** Para quem é, em uma frase. */
  forWho: string;
  send: string[];
  receive: string[];
  time: string;
  steps: { title: string; text: string }[];
  faq: { q: string; a: string }[];
};

/** Explica o módulo para quem chega sem saber o que o app faz: o que envia, o que recebe, quanto tempo, como funciona. */
export function ModuleExplainer(p: ExplainerProps) {
  return (
    <div className="flex flex-col gap-4">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="font-display text-3xl font-bold tracking-tight md:text-4xl">{p.title}</h1>
          <DevBadge />
        </div>
        <p className="mt-2 max-w-2xl text-muted">{p.tagline}</p>
        <p className="mt-1 text-sm text-subtle">{p.forWho}</p>
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        <Card className="p-4">
          <p className="mb-2 flex items-center gap-2 text-sm font-semibold">
            <Send className="size-4 text-violet-300" aria-hidden /> Você envia
          </p>
          <ul className="flex flex-col gap-1.5 text-sm text-muted">
            {p.send.map((s) => (
              <li key={s} className="flex gap-2">
                <span aria-hidden>•</span>
                {s}
              </li>
            ))}
          </ul>
        </Card>
        <Card className="p-4">
          <p className="mb-2 flex items-center gap-2 text-sm font-semibold">
            <Inbox className="size-4 text-emerald-300" aria-hidden /> Você recebe
          </p>
          <ul className="flex flex-col gap-1.5 text-sm text-muted">
            {p.receive.map((s) => (
              <li key={s} className="flex gap-2">
                <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-emerald-400" aria-hidden />
                {s}
              </li>
            ))}
          </ul>
        </Card>
        <Card className="p-4">
          <p className="mb-2 flex items-center gap-2 text-sm font-semibold">
            <Clock className="size-4 text-amber-300" aria-hidden /> Quanto tempo
          </p>
          <p className="text-sm text-muted">{p.time}</p>
          <p className="mt-3 text-xs text-subtle">Você ouve uma prévia grátis de 30 segundos antes de pagar.</p>
          <p className="mt-2 text-xs">
            <SupportLink subject={`dúvida sobre ${p.title}`}>Ficou com dúvida? Chame no WhatsApp</SupportLink>
          </p>
        </Card>
      </div>
      <ol className="grid gap-2 md:grid-cols-4">
        {p.steps.map((s, i) => (
          <li key={s.title} className="rounded-2xl border border-border p-3">
            <span className="bg-brand mb-2 grid size-7 place-items-center rounded-full text-xs font-bold text-white">{i + 1}</span>
            <p className="text-sm font-semibold">{s.title}</p>
            <p className="text-xs text-muted">{s.text}</p>
          </li>
        ))}
      </ol>
    </div>
  );
}

/** Perguntas frequentes (abre e fecha). */
export function Faq({ items }: { items: { q: string; a: string }[] }) {
  const [open, setOpen] = useState<number | null>(null);
  return (
    <div className="flex flex-col divide-y divide-border rounded-2xl border border-border">
      {items.map((f, i) => (
        <div key={f.q}>
          <button type="button" onClick={() => setOpen(open === i ? null : i)} aria-expanded={open === i} className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left text-sm font-medium">
            {f.q}
            <ChevronDown className={cn("size-4 shrink-0 transition", open === i && "rotate-180")} aria-hidden />
          </button>
          {open === i && <p className="px-4 pb-4 text-sm text-muted">{f.a}</p>}
        </div>
      ))}
    </div>
  );
}
