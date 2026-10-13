"use client";

import { MessageCircle } from "lucide-react";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";
import { supportUrl } from "@/lib/support";

/** Link de ajuda pelo WhatsApp; a mensagem já vai com o assunto e a página de onde a pessoa veio. */
export function SupportLink({ subject, children, className, withIcon = true }: { subject?: string; children?: React.ReactNode; className?: string; withIcon?: boolean }) {
  const path = usePathname();
  const msg = `Olá! Preciso de ajuda no Mix Pro${subject ? `: ${subject}` : ""}.${path ? ` (página ${path})` : ""}`;
  return (
    <a href={supportUrl(msg)} target="_blank" rel="noopener noreferrer" className={cn("inline-flex items-center gap-1.5 font-medium text-emerald-300 underline-offset-2 hover:underline", className)}>
      {withIcon && <MessageCircle className="size-4 shrink-0" aria-hidden />}
      {children ?? "Falar no WhatsApp"}
    </a>
  );
}

/** Botão flutuante de ajuda (canto da tela, acima do menu do celular). */
export function SupportFab() {
  const path = usePathname();
  return (
    <a
      href={supportUrl(`Olá! Preciso de ajuda no Mix Pro. (página ${path})`)}
      target="_blank"
      rel="noopener noreferrer"
      data-support-fab
      aria-label="Ajuda pelo WhatsApp"
      className="fixed bottom-[calc(5rem+env(safe-area-inset-bottom))] right-3 z-30 flex h-11 items-center gap-2 rounded-full bg-emerald-500 px-4 text-sm font-semibold text-white shadow-lg shadow-black/40 transition hover:bg-emerald-400 md:bottom-5 md:right-5"
    >
      <MessageCircle className="size-5" aria-hidden />
      <span className="hidden sm:inline">Ajuda</span>
    </a>
  );
}
