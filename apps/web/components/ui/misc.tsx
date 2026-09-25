import { Loader2 } from "lucide-react";
import { cn } from "@/lib/cn";

export function Spinner({ className, label = "Carregando" }: { className?: string; label?: string }) {
  return (
    <span role="status" className={cn("inline-flex items-center gap-2 text-muted", className)}>
      <Loader2 className="size-4 animate-spin" aria-hidden />
      <span className="sr-only">{label}</span>
    </span>
  );
}

export function ProgressBar({ value, className, label }: { value: number; className?: string; label?: string }) {
  const v = Math.max(0, Math.min(100, value));
  return (
    <div
      role="progressbar"
      aria-valuenow={Math.round(v)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
      className={cn("h-2 w-full overflow-hidden rounded-full bg-white/8", className)}
    >
      <div className="bg-brand h-full rounded-full transition-[width] duration-300" style={{ width: `${v}%` }} />
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center gap-3 px-6 py-12 text-center", className)}>
      {icon && <div className="grid size-14 place-items-center rounded-2xl bg-primary/15 text-violet-300">{icon}</div>}
      <h3 className="font-display text-lg font-semibold">{title}</h3>
      {description && <p className="max-w-sm text-sm text-muted">{description}</p>}
      {action}
    </div>
  );
}

export function Chip({
  active,
  className,
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      className={cn(
        "h-8 shrink-0 rounded-full border px-3.5 text-xs font-medium transition",
        active
          ? "bg-brand border-transparent text-white"
          : "border-border-strong text-muted hover:border-white/30 hover:text-text",
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}

export function Logo({ className, compact }: { className?: string; compact?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <svg viewBox="0 0 32 32" className="size-8" aria-hidden>
        <defs>
          <linearGradient id="mp-g" x1="0" x2="1">
            <stop offset="0" stopColor="#d946ef" />
            <stop offset="0.5" stopColor="#7c3aed" />
            <stop offset="1" stopColor="#3b82f6" />
          </linearGradient>
        </defs>
        {[4, 9, 14, 19, 24, 29].map((x, i) => {
          const h = [8, 18, 26, 14, 22, 10][i];
          return <rect key={x} x={x - 1.5} y={16 - h / 2} width="3" height={h} rx="1.5" fill="url(#mp-g)" />;
        })}
      </svg>
      {!compact && <span className="font-display text-xl font-bold tracking-tight">Mix Pro</span>}
    </span>
  );
}
