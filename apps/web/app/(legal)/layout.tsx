import Link from "next/link";
import { Logo } from "@/components/ui/misc";

export default function LegalLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="safe-top pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))] mx-auto max-w-3xl py-10 md:pl-8 md:pr-8">
      <Link href="/" aria-label="Início">
        <Logo />
      </Link>
      <article className="mt-10 flex flex-col gap-4 text-sm leading-relaxed text-muted [&_h1]:font-display [&_h1]:text-3xl [&_h1]:font-semibold [&_h1]:text-text [&_h2]:mt-4 [&_h2]:font-medium [&_h2]:text-text">
        {children}
      </article>
    </div>
  );
}
