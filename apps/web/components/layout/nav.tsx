"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Download, FolderOpen, FlaskConical, Gift, Heart, History, Home, Mic2, Plus, Shield, User } from "lucide-react";
import { Logo } from "@/components/ui/misc";
import { cn } from "@/lib/cn";

const MAIN = [
  { href: "/app", label: "Início", icon: Home, exact: true },
  { href: "/app/projetos", label: "Meus Projetos", icon: FolderOpen },
  { href: "/app/favoritos", label: "Favoritos", icon: Heart },
  { href: "/app/historico", label: "Histórico", icon: History },
  { href: "/app/downloads", label: "Downloads", icon: Download },
  { href: "/app/mixagem-profissional", label: "Mix Profissional", icon: Mic2 },
  { href: "/app/indicacoes", label: "Indicações", icon: Gift },
  { href: "/app/lab", label: "AI Audio Lab", icon: FlaskConical },
];

function isActive(path: string, href: string, exact?: boolean) {
  return exact ? path === href : path === href || path.startsWith(href + "/");
}

export function Sidebar({
  balance,
  freeTotal,
  isAdmin,
  name,
}: {
  balance: number;
  freeTotal: number;
  isAdmin: boolean;
  name: string;
}) {
  const path = usePathname();
  return (
    <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 flex-col border-r border-border bg-bg-elev/60 px-4 py-6 backdrop-blur-xl lg:flex">
      <Link href="/app" className="px-2" aria-label="Mix Pro — início">
        <Logo />
        <p className="mt-1 pl-10 text-xs text-subtle">Seu som, no próximo nível.</p>
      </Link>

      <nav className="mt-8 flex flex-col gap-1" aria-label="Navegação principal">
        {MAIN.map(({ href, label, icon: Icon, exact }) => {
          const active = isActive(path, href, exact);
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex h-11 items-center gap-3 rounded-xl px-3 text-sm transition",
                active ? "bg-brand text-white shadow-lg shadow-primary/20" : "text-muted hover:bg-white/5 hover:text-text",
              )}
            >
              <Icon className="size-[18px]" aria-hidden />
              {label}
            </Link>
          );
        })}
        {isAdmin && (
          <Link
            href="/admin"
            className={cn(
              "mt-2 flex h-11 items-center gap-3 rounded-xl px-3 text-sm transition",
              path.startsWith("/admin") ? "bg-white/10 text-text" : "text-muted hover:bg-white/5 hover:text-text",
            )}
          >
            <Shield className="size-[18px]" aria-hidden />
            Administração
          </Link>
        )}
      </nav>

      <div className="mt-auto flex flex-col gap-3">
        <Link href="/app/perfil" className="flex items-center gap-3 rounded-xl border border-border px-3 py-2.5 text-sm hover:bg-white/5">
          <span className="grid size-8 place-items-center rounded-full bg-white/8">
            <User className="size-4" aria-hidden />
          </span>
          <span className="truncate">{name}</span>
        </Link>
        <div className="glass rounded-2xl p-4">
          <div className="flex items-center justify-between text-xs">
            <span className="font-medium">Downloads disponíveis</span>
            <span className="text-muted tabular-nums">{balance}</span>
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/8">
            <div
              className="bg-brand h-full rounded-full"
              style={{ width: `${Math.min(100, (balance / Math.max(freeTotal, balance, 1)) * 100)}%` }}
            />
          </div>
          <p className="mt-2 text-[11px] text-subtle">Ouvir e testar presets não consome downloads.</p>
          <Link
            href="/app/creditos/comprar"
            className="mt-3 flex h-9 w-full items-center justify-center rounded-full bg-brand text-xs font-semibold text-white shadow shadow-primary/30 hover:brightness-110"
          >
            Comprar créditos
          </Link>
        </div>
      </div>
    </aside>
  );
}

const MOBILE = [
  { href: "/app", label: "Início", icon: Home, exact: true },
  { href: "/app/projetos", label: "Projetos", icon: FolderOpen },
  { href: "/app/novo", label: "Novo", icon: Plus, primary: true },
  { href: "/app/downloads", label: "Downloads", icon: Download },
  { href: "/app/perfil", label: "Perfil", icon: User },
];

export function BottomNav() {
  const path = usePathname();
  return (
    <nav
      aria-label="Navegação"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-bg-elev/90 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl lg:hidden"
    >
      <ul className="mx-auto grid max-w-lg grid-cols-5">
        {MOBILE.map(({ href, label, icon: Icon, exact, primary }) => {
          const active = isActive(path, href, exact);
          return (
            <li key={href}>
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn("flex h-16 flex-col items-center justify-center gap-1 text-[11px]", active ? "text-violet-300" : "text-subtle")}
              >
                {primary ? (
                  <span className="bg-brand grid size-10 place-items-center rounded-full text-white shadow-lg shadow-primary/30">
                    <Icon className="size-5" aria-hidden />
                  </span>
                ) : (
                  <Icon className="size-5" aria-hidden />
                )}
                {!primary && label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
