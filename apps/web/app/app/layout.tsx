import { requireSession } from "@/lib/supabase/server";
import { getBalance, getPublicSetting } from "@/lib/queries";
import { BottomNav, Sidebar } from "@/components/layout/nav";
import { Logo } from "@/components/ui/misc";
import Link from "next/link";

export default async function AppLayout({ children }: LayoutProps<"/app">) {
  const session = await requireSession("/app");
  const [balance, freeTotal] = await Promise.all([getBalance(), getPublicSetting<number>("free_downloads", 5)]);
  const name = session.profile.display_name ?? session.email ?? "Minha conta";

  return (
    <div className="flex min-h-dvh">
      <Sidebar balance={balance} freeTotal={Number(freeTotal)} isAdmin={session.profile.role === "admin"} name={name} />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex items-center justify-between border-b border-border bg-bg/80 px-4 py-3 backdrop-blur-xl lg:hidden">
          <Link href="/app" aria-label="Início">
            <Logo />
          </Link>
          <Link href="/app/downloads" className="rounded-full border border-border px-3 py-1.5 text-xs text-muted">
            <span className="font-semibold text-text tabular-nums">{balance}</span> downloads
          </Link>
        </header>
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 pb-28 pt-6 md:px-8 lg:pb-12 lg:pt-10">{children}</main>
      </div>
      <BottomNav />
    </div>
  );
}
