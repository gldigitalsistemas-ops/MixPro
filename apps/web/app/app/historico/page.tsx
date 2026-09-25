import Link from "next/link";
import { History } from "lucide-react";
import { supabaseServer } from "@/lib/supabase/server";
import { Card } from "@/components/ui/card";
import { Badge, type Tone } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/misc";
import { formatDateTime } from "@/lib/cn";

export const metadata = { title: "Histórico" };

type Row = {
  id: string;
  type: string;
  status: string;
  intensity: number | null;
  cache_hit: boolean;
  created_at: string;
  error_message: string | null;
  project: { id: string; name: string } | null;
  preset_version: { version: number; preset: { name: string } | null } | null;
};

const STATUS: Record<string, { label: string; tone: Tone }> = {
  queued: { label: "Na fila", tone: "info" },
  processing: { label: "Processando", tone: "primary" },
  completed: { label: "Pronto", tone: "success" },
  failed: { label: "Falhou", tone: "danger" },
  cancelled: { label: "Cancelado", tone: "neutral" },
};

const TYPE: Record<string, string> = { analyze: "Análise", preview: "Preview", render: "Exportação" };

export default async function HistoryPage() {
  const supabase = await supabaseServer();
  const { data } = await supabase
    .from("processing_jobs")
    .select("id,type,status,intensity,cache_hit,created_at,error_message,project:projects(id,name),preset_version:preset_versions(version,preset:presets!preset_versions_preset_id_fkey(name))")
    .order("created_at", { ascending: false })
    .limit(100);
  const rows = (data ?? []) as unknown as Row[];

  return (
    <div className="flex flex-col gap-6">
      <h1 className="font-display text-2xl font-semibold">Histórico</h1>
      <Card className="overflow-hidden">
        {rows.length === 0 ? (
          <EmptyState icon={<History className="size-6" />} title="Nada por aqui ainda" description="Seus processamentos aparecerão aqui." />
        ) : (
          <ul className="divide-y divide-border">
            {rows.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 text-sm">
                <div className="min-w-0">
                  <p className="truncate">
                    {r.project ? (
                      <Link href={`/app/projetos/${r.project.id}`} className="font-medium hover:underline">
                        {r.project.name}
                      </Link>
                    ) : (
                      <span className="text-muted">Projeto excluído</span>
                    )}{" "}
                    <span className="text-muted">
                      — {TYPE[r.type] ?? r.type}
                      {r.preset_version?.preset ? ` · ${r.preset_version.preset.name} v${r.preset_version.version} · ${r.intensity}%` : ""}
                    </span>
                  </p>
                  <p className="text-xs text-subtle">
                    {formatDateTime(r.created_at)}
                    {r.cache_hit ? " · resultado reaproveitado" : ""}
                    {r.status === "failed" && r.error_message ? ` · ${r.error_message}` : ""}
                  </p>
                </div>
                <Badge tone={STATUS[r.status]?.tone}>{STATUS[r.status]?.label ?? r.status}</Badge>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
