import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requireAdmin } from "@/lib/supabase/server";
import { Logo } from "@/components/ui/misc";
import { AdminTabs } from "./tabs";

export const metadata = { title: { default: "Administração", template: "%s · Admin Mix Pro" }, robots: { index: false } };

export default async function AdminLayout({ children }: LayoutProps<"/admin">) {
  await requireAdmin();
  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-30 border-b border-border bg-bg/85 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl items-center gap-6 px-4 py-3 md:px-8">
          <Link href="/app" className="flex items-center gap-2 text-sm text-muted hover:text-text">
            <ArrowLeft className="size-4" aria-hidden />
            <Logo compact />
            <span className="hidden font-display font-semibold text-text sm:inline">Admin</span>
          </Link>
          <AdminTabs />
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-8 md:px-8">{children}</main>
    </div>
  );
}
