import Link from "next/link";
import { supabaseServer } from "@/lib/supabase/server";
import { Card } from "@/components/ui/card";
import { formatBytes } from "@/lib/cn";
import { ProcessorStatus } from "@/components/audio/processor-status";

type Metrics = Record<string, number | null> & {
  top_previewed: { name: string; n: number }[];
  top_downloaded: { name: string; n: number }[];
};

export default async function AdminHome(props: PageProps<"/admin">) {
  const sp = await props.searchParams;
  const days = [7, 30, 90].includes(Number(sp.dias)) ? Number(sp.dias) : 30;
  const supabase = await supabaseServer();
  const { data } = await supabase.rpc("admin_metrics", { p_days: days });
  const m = (data ?? {}) as Metrics;

  const cards: [string, React.ReactNode, string?][] = [
    ["Usuários cadastrados", m.users_total, `+${m.users_new ?? 0} no período`],
    ["Usuários ativos", m.users_active, "com processamento no período"],
    ["Projetos", m.projects],
    ["Uploads", m.uploads],
    ["Processamentos", m.jobs, `${m.cache_hits ?? 0} reaproveitados do cache`],
    ["Com erro", m.jobs_failed, `${m.jobs_queued ?? 0} na fila agora`],
    ["Tempo médio", m.avg_processing_ms ? `${(Number(m.avg_processing_ms) / 1000).toFixed(1)} s` : "—", "por processamento"],
    ["Downloads", m.downloads_total, `${m.downloads_charged ?? 0} cobrados`],
    ["Créditos distribuídos", m.credits_granted],
    ["Armazenamento", formatBytes(Number(m.storage_bytes ?? 0)), "arquivos ativos"],
    ["Receita (R$)", m.revenue_brl != null ? `R$ ${Number(m.revenue_brl).toFixed(2).replace(".", ",")}` : "R$ 0,00", `${m.payments_approved ?? 0} pagamentos aprovados`],
    ["Pedidos Mix Pro", m.pro_orders_total, `${m.pro_orders_active ?? 0} em aberto`],
    ["Indicações", m.referrals_new, `${m.referrals_total ?? 0} total qualificadas`],
  ];

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="font-display text-2xl font-semibold">Visão geral</h1>
        <div className="flex gap-1 rounded-full border border-border p-1 text-sm">
          {[7, 30, 90].map((d) => (
            <Link
              key={d}
              href={`/admin?dias=${d}`}
              className={d === days ? "bg-brand rounded-full px-3 py-1 text-white" : "px-3 py-1 text-muted hover:text-text"}
            >
              {d} dias
            </Link>
          ))}
        </div>
      </div>

      <Card className="p-5">
        <ProcessorStatus />
      </Card>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">
        {cards.map(([label, value, hint]) => (
          <Card key={label} className="p-4">
            <p className="text-xs text-muted">{label}</p>
            <p className="mt-1 font-display text-2xl font-semibold tabular-nums">{value ?? 0}</p>
            {hint && <p className="mt-0.5 text-[11px] text-subtle">{hint}</p>}
          </Card>
        ))}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {(
          [
            ["Presets mais testados", m.top_previewed],
            ["Presets mais baixados", m.top_downloaded],
          ] as const
        ).map(([title, list]) => (
          <Card key={title} className="p-5">
            <h2 className="mb-3 font-medium">{title}</h2>
            {!list?.length ? (
              <p className="text-sm text-muted">Sem dados no período.</p>
            ) : (
              <ol className="flex flex-col gap-2">
                {list.map((r) => {
                  const max = list[0].n || 1;
                  return (
                    <li key={r.name} className="text-sm">
                      <div className="flex justify-between">
                        <span>{r.name}</span>
                        <span className="tabular-nums text-muted">{r.n}</span>
                      </div>
                      <div className="mt-1 h-1.5 rounded-full bg-white/6">
                        <div className="bg-brand h-full rounded-full" style={{ width: `${(r.n / max) * 100}%` }} />
                      </div>
                    </li>
                  );
                })}
              </ol>
            )}
          </Card>
        ))}
      </div>
    </div>
  );
}
