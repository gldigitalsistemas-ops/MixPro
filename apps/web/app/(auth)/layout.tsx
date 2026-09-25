import Link from "next/link";
import { Logo } from "@/components/ui/misc";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative flex min-h-dvh flex-col items-center justify-center overflow-hidden px-4 py-10">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-0 h-72 opacity-60"
        style={{
          background:
            "radial-gradient(60% 80% at 20% 100%, rgba(217,70,239,.35), transparent 70%), radial-gradient(60% 80% at 80% 100%, rgba(59,130,246,.35), transparent 70%)",
        }}
      />
      <Link href="/" className="relative mb-8" aria-label="Mix Pro — página inicial">
        <Logo />
      </Link>
      <div className="glass relative w-full max-w-md rounded-3xl bg-surface/70 p-6 md:p-8">{children}</div>
    </div>
  );
}
