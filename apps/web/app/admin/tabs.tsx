"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";

const TABS = [
  { href: "/admin", label: "Visão geral", exact: true },
  { href: "/admin/presets", label: "Presets" },
  { href: "/admin/bateria", label: "Samples de bateria" },
  { href: "/admin/pedidos-pro", label: "Mixagem Pro" },
  { href: "/admin/pagamentos", label: "Pagamentos" },
  { href: "/admin/usuarios", label: "Usuários" },
  { href: "/admin/configuracoes", label: "Configurações" },
];

export function AdminTabs() {
  const path = usePathname();
  return (
    <nav className="-mb-3 flex gap-1 overflow-x-auto" aria-label="Administração">
      {TABS.map((t) => {
        const active = t.exact ? path === t.href : path.startsWith(t.href);
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "whitespace-nowrap border-b-2 px-3 pb-3 pt-1 text-sm transition",
              active ? "border-violet-400 text-text" : "border-transparent text-muted hover:text-text",
            )}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
