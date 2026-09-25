import { cn } from "@/lib/cn";

export type Tone = "neutral" | "success" | "warning" | "danger" | "primary" | "info";

const tones: Record<Tone, string> = {
  neutral: "bg-white/6 text-muted border-white/10",
  success: "bg-success/12 text-green-300 border-success/25",
  warning: "bg-warning/12 text-amber-300 border-warning/25",
  danger: "bg-danger/12 text-red-300 border-danger/25",
  primary: "bg-primary/15 text-violet-300 border-primary/30",
  info: "bg-blue/12 text-blue-300 border-blue/25",
};

export function Badge({
  tone = "neutral",
  className,
  children,
}: {
  tone?: Tone;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium",
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
