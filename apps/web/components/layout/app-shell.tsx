"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Coins, FolderClock, Gift, Mic2, MonitorDown, Shield, AudioLines, SlidersHorizontal, UserRound, Wand2 } from "lucide-react";
import { useInstallApp } from "@/components/pwa/pwa";
import { useAccountCtx } from "@/components/account/account-provider";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/ui/misc";
import { cn } from "@/lib/cn";

const NAV = [
  { href: "/estudio", label: "Estúdio", icon: SlidersHorizontal },
  { href: "/ferramentas", label: "Ferramentas", short: "Ferram.", icon: Wand2 },
  { href: "/projetos", label: "Meus projetos", short: "Projetos", icon: FolderClock },
  { href: "/vs", label: "Criar VS", short: "VS", icon: AudioLines },
  { href: "/mixagem-profissional", label: "Mixagem Pro", short: "Pro", icon: Mic2 },
  { href: "/creditos", label: "Créditos", icon: Coins },
  { href: "/indicar", label: "Indicar", icon: Gift },
  { href: "/conta", label: "Conta", icon: UserRound },
];

const active = (path: string, href: string) => path === href || path.startsWith(href + "/");

export function AppShell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const { user, account, isAdmin, requireLogin } = useAccountCtx();
  const install = useInstallApp();

  return (
    <div className="flex min-h-dvh flex-col pb-[calc(4.5rem+env(safe-area-inset-bottom))] md:pb-0">
      <header className="safe-top safe-x sticky top-0 z-40 border-b border-border bg-bg/85 backdrop-blur-xl">
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center gap-6 px-4 md:px-8">
          <Link href="/" aria-label="Mix Pro — início">
            <Logo />
          </Link>
          <nav className="hidden flex-1 items-center gap-1 md:flex" aria-label="Navegação principal">
            {NAV.filter((n) => n.href !== "/conta").map(({ href, label, icon: Icon }) => (
              <Link
                key={href}
                href={href}
                aria-current={active(path, href) ? "page" : undefined}
                className={cn(
                  "flex h-9 items-center gap-2 rounded-full px-3.5 text-sm transition",
                  active(path, href) ? "bg-white/10 text-text" : "text-muted hover:bg-white/5 hover:text-text",
                )}
              >
                <Icon className="size-4" aria-hidden /> {label}
              </Link>
            ))}
            {isAdmin && (
              <Link href="/admin" className="flex h-9 items-center gap-2 rounded-full px-3.5 text-sm text-muted hover:bg-white/5 hover:text-text">
                <Shield className="size-4" aria-hidden /> Admin
              </Link>
            )}
          </nav>
          <div className="ml-auto flex items-center gap-2">
            {install && (
              <button
                onClick={() => void install()}
                className="flex h-9 items-center gap-1.5 rounded-full border border-violet-400/40 bg-primary/15 px-3 text-xs text-violet-200"
              >
                <MonitorDown className="size-4" aria-hidden /> Instalar app
              </button>
            )}
            {user && (
              <Link
                href="/creditos"
                className="flex h-9 items-center gap-2 rounded-full border border-border-strong px-3.5 text-sm transition hover:bg-white/5"
              >
                <Coins className="size-4 text-amber-300" aria-hidden />
                <strong className="tabular-nums">{account?.balance ?? "…"}</strong>
                <span className="hidden text-muted sm:inline">créditos</span>
              </Link>
            )}
            {user ? (
              <Link
                href="/conta"
                aria-label="Minha conta"
                className="hidden size-9 place-items-center rounded-full bg-brand text-sm font-semibold text-white md:grid"
              >
                {(user.name ?? user.email ?? "?").slice(0, 1).toUpperCase()}
              </Link>
            ) : (
              <Button size="sm" variant="secondary" onClick={() => void requireLogin()}>
                Entrar
              </Button>
            )}
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 md:px-8">{children}</main>

      <footer className="hidden border-t border-border px-4 py-6 text-center text-xs text-subtle md:block">
        Mix Pro · <Link href="/termos" className="hover:text-text">Termos</Link> ·{" "}
        <Link href="/privacidade" className="hover:text-text">Privacidade</Link>
      </footer>

      <nav
        className="safe-x fixed inset-x-0 bottom-0 z-40 grid grid-cols-6 border-t border-border bg-bg/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl md:hidden"
        aria-label="Navegação"
      >
        {/* 6 itens cabem no celular: "Indicar" e "Mixagem Pro" ficam na página Conta */}
        {NAV.filter((n) => n.href !== "/indicar" && n.href !== "/mixagem-profissional").map(({ href, label, short, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            aria-current={active(path, href) ? "page" : undefined}
            className={cn(
              "flex h-16 flex-col items-center justify-center gap-1 text-[11px] transition",
              active(path, href) ? "text-violet-300" : "text-muted",
            )}
          >
            <Icon className="size-5" aria-hidden />
            {short ?? label}
          </Link>
        ))}
      </nav>
    </div>
  );
}
