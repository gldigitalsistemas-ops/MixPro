import Link from "next/link";
import { supabaseServer } from "@/lib/supabase/server";
import { Card } from "@/components/ui/card";
import { Badge, type Tone } from "@/components/ui/badge";
import { formatDateTime } from "@/lib/cn";

export const metadata = { title: "Jobs" };

const TONE: Record<string, Tone> = { queued: "info", processing: "primary", completed: "success", failed: "danger", cancelled: "neutral" };
const FILTERS = ["failed", "queued", "processing", "completed", "all"] as const;
const FILTER_LABEL: Record<(typeof FILTERS)[number], string> = {
  failed: "Com erro",
  queued: "Na fila",
  processing: "Processando",
  completed: "Concluídos",
  all: "Todos",
};

type Row = {
  id: string;
  type: string;
  status: string;
  stage: string | null;
  worker_id: string | null;
  attempts: number;
  duration_ms: number | null;
  cache_hit: boolean;
  error_code: string | null;
  error_message: string | null;
  created_at: string;
  user_id: string;
  project: { name: string } | null;
  preset_version: { version: number; preset: { name: string } | null } | null;
};

export default async function AdminJobs(props: PageProps<"/admin/jobs">) {
  const sp = await props.searchParams;
  const filter = (FILTERS as readonly string[]).includes(String(sp.status)) ? (sp.status as (typeof FILTERS)[number]) : "failed";
  const supabase = await supabaseServer();
  let q = supabase
    .from("processing_jobs")
    .select("id,type,status,stage,worker_id,attempts,duration_ms,cache_hit,error_code,error_message,created_at,user_id,project:projects(name),preset_version:preset_versions(version,preset:presets!preset_versions_preset_id_fkey(name))")
    .order("created_at", { ascending: false })
    .limit(150);
  if (filter !== "all") q = q.eq("status", filter);
  const [{ data }, { data: workers }] = await Promise.all([q, supabase.from("workers").select("*").order("last_heartbeat_at", { ascending: false })]);
  const rows = (data ?? []) as unknown as Row[];
  // Server Component renderizado por requisição: o instante atual é intencional aqui.
  // eslint-disable-next-line react-hooks/purity
  const now = Date.now();

  return (
    <div className="flex flex-col gap-6">
      <h1 className="font-display text-2xl font-semibold">Jobs de processamento</h1>

      <Card className="p-5">
        <h2 className="mb-3 font-medium">Workers</h2>
        {(workers ?? []).length === 0 ? (
          <p className="text-sm text-muted">Nenhum worker conectou ainda. Veja docs/worker.md para iniciar o processador.</p>
        ) : (
          <ul className="flex flex-col gap-2 text-sm">
            {(workers ?? []).map((w) => {
              const online = now - new Date(w.last_heartbeat_at).getTime() < 60_000;
              return (
                <li key={w.id} className="flex flex-wrap items-center justify-between gap-2">
                  <span>
                    <span className={online ? "text-green-300" : "text-subtle"}>●</span> {w.id}{" "}
                    <span className="text-xs text-subtle">
                      {w.hostname} · v{w.version}
                    </span>
                  </span>
                  <span className="text-xs text-muted">último sinal {formatDateTime(w.last_heartbeat_at)}</span>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <Link
            key={f}
            href={`/admin/jobs?status=${f}`}
            className={f === filter ? "bg-brand rounded-full px-3 py-1.5 text-sm text-white" : "rounded-full border border-border px-3 py-1.5 text-sm text-muted hover:text-text"}
          >
            {FILTER_LABEL[f]}
          </Link>
        ))}
      </div>

      <Card className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-sm">
          <thead className="text-left text-xs text-subtle">
            <tr className="border-b border-border">
              <th className="px-4 py-3 font-normal">Quando</th>
              <th className="px-4 py-3 font-normal">Tipo</th>
              <th className="px-4 py-3 font-normal">Projeto / preset</th>
              <th className="px-4 py-3 font-normal">Worker</th>
              <th className="px-4 py-3 font-normal">Duração</th>
              <th className="px-4 py-3 font-normal">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((r) => (
              <tr key={r.id} className="align-top">
                <td className="px-4 py-3 text-xs text-muted">{formatDateTime(r.created_at)}</td>
                <td className="px-4 py-3">{r.type}</td>
                <td className="px-4 py-3">
                  <p>{r.project?.name ?? "—"}</p>
                  <p className="text-xs text-subtle">
                    {r.preset_version?.preset ? `${r.preset_version.preset.name} v${r.preset_version.version}` : ""}
                  </p>
                  {r.error_message && (
                    <p className="mt-1 text-xs text-red-300">
                      [{r.error_code}] {r.error_message}
                    </p>
                  )}
                </td>
                <td className="px-4 py-3 text-xs text-muted">
                  {r.worker_id ?? "—"}
                  {r.attempts > 1 && <span className="block">{r.attempts} tentativas</span>}
                </td>
                <td className="px-4 py-3 text-xs tabular-nums text-muted">
                  {r.cache_hit ? "cache" : r.duration_ms ? `${(r.duration_ms / 1000).toFixed(1)} s` : "—"}
                </td>
                <td className="px-4 py-3">
                  <Badge tone={TONE[r.status]}>{r.status}</Badge>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-muted">
                  Nenhum job neste filtro.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
