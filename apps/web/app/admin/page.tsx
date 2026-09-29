import Link from "next/link";
import { supabaseServer } from "@/lib/supabase/server";
import { Card } from "@/components/ui/card";

type Metrics = Record<string, number | null>;

/** O ref da exportação é `<arquivo>_<slug-do-preset>_<intensidade>_<social>_<formato>`. */
function presetSlugFromRef(ref: string | null): string | null {
  const parts = ref?.split("_") ?? [];
  return parts.length >= 5 ? parts[1] : null;
}

function daysAgoIso(days: number) {
  return new Date(Date.now() - days * 86400_000).toISOString();
}

export default async function AdminHome(props: PageProps<"/admin">) {
  const sp = await props.searchParams;
  const days = [7, 30, 90].includes(Number(sp.dias)) ? Number(sp.dias) : 30;
  const since = daysAgoIso(days);
  const supabase = await supabaseServer();

  const [{ data }, exports, presets] = await Promise.all([
    supabase.rpc("admin_metrics", { p_days: days }),
    supabase
      .from("credit_transactions")
      .select("reason, reference_id")
      .eq("type", "DOWNLOAD")
      .gte("created_at", since)
      .limit(10000),
    supabase.from("presets").select("slug, name"),
  ]);
  const m = (data ?? {}) as Metrics;
  const rows = exports.data ?? [];
  const videos = rows.filter((r) => r.reason === "Vídeo exportado").length;

  const names = new Map((presets.data ?? []).map((p) => [p.slug as string, p.name as string]));
  const counts = new Map<string, number>();
  for (const r of rows) {
    const slug = presetSlugFromRef(r.reference_id);
    if (slug) counts.set(slug, (counts.get(slug) ?? 0) + 1);
  }
  const top = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([slug, n]) => ({ name: names.get(slug) ?? slug, n }));

  const cards: [string, React.ReactNode, string?][] = [
    ["Usuários", m.users_total, `+${m.users_new ?? 0} no período`],
    ["Exportações", rows.length, `${videos} vídeos · ${rows.length - videos} áudios`],
    ["Indicações convertidas", m.referrals_new, `${m.referrals_total ?? 0} no total`],
    ["Créditos distribuídos", m.credits_granted, "mensais + indicações"],
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

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {cards.map(([label, value, hint]) => (
          <Card key={label} className="p-4">
            <p className="text-xs text-muted">{label}</p>
            <p className="mt-1 font-display text-2xl font-semibold tabular-nums">{value ?? 0}</p>
            {hint && <p className="mt-0.5 text-[11px] text-subtle">{hint}</p>}
          </Card>
        ))}
      </div>

      <Card className="p-5">
        <h2 className="mb-3 font-medium">Presets mais baixados</h2>
        {!top.length ? (
          <p className="text-sm text-muted">Sem dados no período.</p>
        ) : (
          <ol className="flex flex-col gap-2">
            {top.map((r) => (
              <li key={r.name} className="text-sm">
                <div className="flex justify-between">
                  <span>{r.name}</span>
                  <span className="tabular-nums text-muted">{r.n}</span>
                </div>
                <div className="mt-1 h-1.5 rounded-full bg-white/6">
                  <div className="bg-brand h-full rounded-full" style={{ width: `${(r.n / top[0].n) * 100}%` }} />
                </div>
              </li>
            ))}
          </ol>
        )}
      </Card>
    </div>
  );
}
