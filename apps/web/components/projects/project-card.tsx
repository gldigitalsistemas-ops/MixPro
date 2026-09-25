import Link from "next/link";
import { Badge, type Tone } from "@/components/ui/badge";
import { AUDIO_TYPE_LABEL, type AudioType } from "@/lib/types";
import { formatDate, formatDuration } from "@/lib/cn";

export type ProjectSummary = {
  id: string;
  name: string;
  audio_type: AudioType;
  created_at: string;
  last_processed_at: string | null;
  track_count: number;
  duration_s: number | null;
  file_status: string | null;
  thumb: number[] | null;
};

function status(p: ProjectSummary): { label: string; tone: Tone } {
  if (p.file_status === "invalid") return { label: "Arquivo inválido", tone: "danger" };
  if (!p.file_status || p.file_status === "uploading") return { label: "Aguardando áudio", tone: "warning" };
  if (p.file_status !== "ready") return { label: "Analisando", tone: "info" };
  if (p.last_processed_at) return { label: "Processado", tone: "success" };
  return { label: "Pronto para testar", tone: "primary" };
}

function Thumb({ peaks }: { peaks: number[] | null }) {
  const data = peaks && peaks.length ? peaks : Array.from({ length: 64 }, () => 6);
  return (
    <svg viewBox={`0 0 ${data.length * 3} 40`} preserveAspectRatio="none" className="h-16 w-full" aria-hidden>
      <defs>
        <linearGradient id="thumb-g" x1="0" x2="1">
          <stop offset="0" stopColor="#d946ef" />
          <stop offset="0.5" stopColor="#7c3aed" />
          <stop offset="1" stopColor="#3b82f6" />
        </linearGradient>
      </defs>
      {data.map((v, i) => {
        const h = Math.max(1.5, (v / 255) * 38);
        return <rect key={i} x={i * 3} y={20 - h / 2} width={2} height={h} rx={1} fill="url(#thumb-g)" opacity={peaks ? 1 : 0.25} />;
      })}
    </svg>
  );
}

export function ProjectCard({ p }: { p: ProjectSummary }) {
  const s = status(p);
  return (
    <Link
      href={`/app/projetos/${p.id}`}
      className="glass group flex flex-col gap-3 rounded-[var(--radius-card)] p-4 transition hover:border-white/20 hover:bg-white/[0.04]"
    >
      <div className="rounded-xl bg-black/30 px-3 py-2">
        <Thumb peaks={p.thumb} />
      </div>
      <div className="min-w-0">
        <h3 className="truncate font-medium group-hover:text-white">{p.name}</h3>
        <p className="mt-0.5 text-xs text-muted">
          {AUDIO_TYPE_LABEL[p.audio_type]} · {p.track_count} {p.track_count === 1 ? "faixa" : "faixas"}
        </p>
        <p className="text-xs text-subtle">
          {formatDate(p.created_at)} · {formatDuration(p.duration_s)}
        </p>
      </div>
      <Badge tone={s.tone} className="self-start">
        {s.label}
      </Badge>
    </Link>
  );
}
