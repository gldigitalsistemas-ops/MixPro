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

  // contagens exatas (o Supabase devolve no máximo 1000 linhas por consulta)
  const countEvent = async (event: string, prop?: [string, string]) => {
    let q = supabase.from("analytics_events").select("id", { count: "exact", head: true }).eq("event", event).gte("created_at", since);
    if (prop) q = q.eq(`props->>${prop[0]}`, prop[1]);
    return (await q).count ?? 0;
  };
  const EVENTS = ["studio_open", "file_loaded", "captions_generated", "export", "share", "checkout_start", "tour_done", "style_saved"];

  const countDownloads = async (reason?: string) => {
    let q = supabase.from("credit_transactions").select("id", { count: "exact", head: true }).eq("type", "DOWNLOAD").gte("created_at", since);
    if (reason) q = q.eq("reason", reason);
    return (await q).count ?? 0;
  };

  const [{ data }, exports, presets, eventCounts, videoFiles, withCaptions, withMusic, downloads, videos] = await Promise.all([
    supabase.rpc("admin_metrics", { p_days: days }),
    supabase
      .from("credit_transactions")
      .select("reason, reference_id")
      .eq("type", "DOWNLOAD")
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(1000),
    supabase.from("presets").select("slug, name"),
    Promise.all(EVENTS.map((e) => countEvent(e))),
    countEvent("file_loaded", ["kind", "video"]),
    countEvent("export", ["captions", "true"]),
    countEvent("export", ["music", "true"]),
    countDownloads(),
    countDownloads("Vídeo exportado"),
  ]);
  const count = (k: string) => eventCounts[EVENTS.indexOf(k)] ?? 0;
  const funnel = [
    { label: "Abriram o estúdio", n: count("studio_open") },
    { label: "Enviaram um arquivo", n: count("file_loaded"), hint: `${videoFiles} vídeos · ${count("file_loaded") - videoFiles} áudios` },
    { label: "Geraram legendas", n: count("captions_generated") },
    { label: "Baixaram", n: count("export"), hint: `${withCaptions} com legendas · ${withMusic} com música` },
    { label: "Postaram pelo app", n: count("share") },
  ];
  const extras: [string, number][] = [
    ["Abriram o pagamento", count("checkout_start")],
    ["Concluíram as dicas", count("tour_done")],
    ["Salvaram um estilo", count("style_saved")],
  ];
  const m = (data ?? {}) as Metrics;
  // ranking de presets: amostra das últimas 1000 exportações (limite do Supabase por consulta)
  const rows = exports.data ?? [];

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
    ["Exportações", downloads, `${videos} vídeos · ${downloads - videos} áudios`],
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
        <h2 className="font-medium">Uso do app</h2>
        <p className="mb-4 text-xs text-muted">Do primeiro acesso ao post, no período (inclui visitantes sem conta).</p>
        <ol className="flex flex-col gap-3">
          {funnel.map((f, i) => {
            const base = funnel[0].n || 1;
            const prev = i > 0 ? funnel[i - 1].n : 0;
            return (
              <li key={f.label} className="text-sm">
                <div className="flex flex-wrap justify-between gap-x-3">
                  <span>{f.label}</span>
                  <span className="tabular-nums text-muted">
                    {f.n}
                    {i > 0 && prev > 0 && <span className="text-subtle"> · {Math.round((f.n / prev) * 100)}% da etapa anterior</span>}
                  </span>
                </div>
                <div className="mt-1 h-2 rounded-full bg-white/6">
                  <div className="bg-brand h-full rounded-full" style={{ width: `${Math.min(100, (f.n / base) * 100)}%` }} />
                </div>
                {f.hint && <p className="mt-0.5 text-[11px] text-subtle">{f.hint}</p>}
              </li>
            );
          })}
        </ol>
        <div className="mt-4 grid grid-cols-3 gap-2 border-t border-border pt-4">
          {extras.map(([label, n]) => (
            <div key={label}>
              <p className="font-display text-lg font-semibold tabular-nums">{n}</p>
              <p className="text-[11px] text-muted">{label}</p>
            </div>
          ))}
        </div>
      </Card>

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
