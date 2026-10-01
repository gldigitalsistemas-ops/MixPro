import Link from "next/link";
import { requireAdmin, supabaseAdmin } from "@/lib/supabase/server";
import { Badge, type Tone } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { cn, formatDateTime } from "@/lib/cn";
import { LogActions } from "./actions";

export const metadata = { title: "Logs" };

type Row = {
  id: number;
  created_at: string;
  user_id: string | null;
  client_id: string;
  severity: "erro" | "queda" | "aviso";
  area: string;
  fingerprint: string;
  message: string;
  cause: string | null;
  stack: string | null;
  browser: string | null;
  os: string | null;
  device: string | null;
  build: string | null;
  route: string | null;
  context: Record<string, unknown>;
  resolved_at: string | null;
};

const SEVERITY: Record<Row["severity"], { label: string; tone: Tone; hint: string }> = {
  queda: { label: "Queda", tone: "danger", hint: "o navegador fechou a página" },
  erro: { label: "Erro", tone: "warning", hint: "falhou e o usuário viu" },
  aviso: { label: "Aviso", tone: "neutral", hint: "falha esperada: arquivo, rede ou navegador" },
};
const ORDER: Row["severity"][] = ["queda", "erro", "aviso"];
const PERIODS = [
  { days: 1, label: "24 horas" },
  { days: 7, label: "7 dias" },
  { days: 30, label: "30 dias" },
];

/** Data de N dias atrás (fora da renderização: a regra de pureza do React não aceita Date.now() nela). */
function daysAgo(days: number) {
  return new Date(Date.now() - days * 86400_000).toISOString();
}

function tally(values: (string | null)[]) {
  const m = new Map<string, number>();
  for (const v of values) m.set(v || "—", (m.get(v || "—") ?? 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
}

export default async function AdminLogs(props: PageProps<"/admin/logs">) {
  await requireAdmin();
  const sp = await props.searchParams;
  const days = PERIODS.some((p) => String(p.days) === sp.dias) ? Number(sp.dias) : 7;
  const showResolved = sp.ver === "todos";
  const sev = ORDER.includes(sp.tipo as Row["severity"]) ? (sp.tipo as Row["severity"]) : null;
  const since = daysAgo(days);

  const admin = supabaseAdmin();
  const [{ data, error }, { data: authList }] = await Promise.all([
    admin.from("app_errors").select("*").gte("created_at", since).order("created_at", { ascending: false }).limit(3000),
    admin.auth.admin.listUsers({ page: 1, perPage: 1000 }),
  ]);
  const emails = new Map((authList?.users ?? []).map((u) => [u.id, u.email ?? ""]));
  const rows = (data ?? []) as Row[];

  if (error) {
    return (
      <Card className="p-5 text-sm">
        Não foi possível ler os logs: {error.message}. A migração <code>20261001000009_error_logs.sql</code> já foi rodada no Supabase?
      </Card>
    );
  }

  // grupos: o mesmo erro (mesma etapa e mensagem) em vários aparelhos vira uma linha só
  const groups = new Map<string, Row[]>();
  for (const r of rows) groups.set(r.fingerprint, [...(groups.get(r.fingerprint) ?? []), r]);
  const list = [...groups.values()]
    .map((g) => ({
      rows: g,
      last: g[0],
      open: g.filter((r) => !r.resolved_at).length,
      people: new Set(g.map((r) => r.user_id ?? r.client_id)).size,
      severity: ORDER.find((s) => g.some((r) => r.severity === s))!,
    }))
    .filter((g) => (showResolved || g.open > 0) && (!sev || g.severity === sev))
    .sort((a, b) => ORDER.indexOf(a.severity) - ORDER.indexOf(b.severity) || b.rows.length - a.rows.length);

  const live = rows.filter((r) => !r.resolved_at);
  const people = new Set(live.filter((r) => r.severity !== "aviso").map((r) => r.user_id ?? r.client_id)).size;
  const byBrowser = tally(live.filter((r) => r.severity !== "aviso").map((r) => r.browser));
  const href = (patch: Record<string, string | null>) => {
    const q = new URLSearchParams({ dias: String(days), ...(showResolved ? { ver: "todos" } : {}), ...(sev ? { tipo: sev } : {}) });
    for (const [k, v] of Object.entries(patch)) {
      if (v === null) q.delete(k);
      else q.set(k, v);
    }
    return `/admin/logs?${q}`;
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-semibold">Logs de erros</h1>
          <p className="max-w-3xl text-sm text-muted">
            Tudo que deu errado no aparelho de qualquer usuário (inclusive você), com navegador, etapa e causa provável. “Queda” é quando o
            navegador fechou a página sozinho no meio de uma tarefa, quase sempre falta de memória no celular; ela é registrada quando a
            pessoa volta ao app.
          </p>
        </div>
        <div className="flex flex-wrap gap-1 text-sm">
          {PERIODS.map((p) => (
            <Link
              key={p.days}
              href={href({ dias: String(p.days) })}
              className={cn("rounded-full px-3 py-1", p.days === days ? "bg-white/12 text-text" : "text-muted hover:text-text")}
            >
              {p.label}
            </Link>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {ORDER.map((s) => (
          <Link key={s} href={href({ tipo: sev === s ? null : s })}>
            <Card className={cn("p-4 transition hover:bg-white/5", sev === s && "border-violet-400")}>
              <p className="text-xs text-muted">
                {SEVERITY[s].label}s · {SEVERITY[s].hint}
              </p>
              <p className="font-display text-2xl font-semibold">{live.filter((r) => r.severity === s).length}</p>
            </Card>
          </Link>
        ))}
        <Card className="p-4">
          <p className="text-xs text-muted">Pessoas afetadas (erros e quedas)</p>
          <p className="font-display text-2xl font-semibold">{people}</p>
        </Card>
      </div>

      {byBrowser.length > 0 && (
        <Card className="flex flex-col gap-2 p-4">
          <p className="text-sm font-medium">Onde mais dá problema</p>
          <div className="flex flex-wrap gap-1.5">
            {byBrowser.slice(0, 8).map(([b, n]) => (
              <Badge key={b}>
                {b} · {n}
              </Badge>
            ))}
          </div>
        </Card>
      )}

      <div className="flex items-center justify-between">
        <p className="text-sm text-muted">
          {list.length} {list.length === 1 ? "problema" : "problemas"} {showResolved ? "(com os resolvidos)" : "em aberto"}
          {sev && ` · só ${SEVERITY[sev].label.toLowerCase()}s`}
        </p>
        <Link href={href({ ver: showResolved ? null : "todos" })} className="text-sm text-violet-300 hover:text-white">
          {showResolved ? "Esconder resolvidos" : "Mostrar resolvidos"}
        </Link>
      </div>

      {list.length === 0 && (
        <Card className="p-6 text-center text-sm text-muted">Nenhum problema registrado neste período. 🎉</Card>
      )}

      <ul className="flex flex-col gap-3">
        {list.map(({ rows: g, last, open, people: n, severity }) => (
          <li key={last.fingerprint}>
            <Card className={cn("flex flex-col gap-3 p-4", open === 0 && "opacity-60")}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex min-w-0 flex-col gap-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={SEVERITY[severity].tone}>{SEVERITY[severity].label}</Badge>
                    <Badge tone="primary">{last.area}</Badge>
                    <span className="text-xs text-muted">
                      {g.length}× · {n} {n === 1 ? "pessoa" : "pessoas"} · última {formatDateTime(last.created_at)} · primeira{" "}
                      {formatDateTime(g[g.length - 1].created_at)}
                    </span>
                    {open === 0 && <Badge tone="success">Resolvido</Badge>}
                  </div>
                  <p className="break-words font-mono text-sm">{last.message}</p>
                </div>
                <LogActions fingerprint={last.fingerprint} resolved={open === 0} />
              </div>

              {last.cause && (
                <p className="rounded-xl border border-amber-400/25 bg-amber-400/8 px-3 py-2 text-sm">
                  <span className="font-semibold text-amber-200">Causa provável: </span>
                  {last.cause}
                </p>
              )}

              <div className="flex flex-wrap gap-1.5 text-xs">
                {tally(g.map((r) => r.browser)).map(([b, c]) => (
                  <Badge key={`b-${b}`}>
                    {b} · {c}
                  </Badge>
                ))}
                {tally(g.map((r) => r.os)).map(([o, c]) => (
                  <Badge key={`o-${o}`} tone="info">
                    {o} · {c}
                  </Badge>
                ))}
                {tally(g.map((r) => r.build)).map(([v, c]) => (
                  <Badge key={`v-${v}`}>
                    versão {v} · {c}
                  </Badge>
                ))}
              </div>

              <details className="text-sm">
                <summary className="cursor-pointer text-violet-300 hover:text-white">Ocorrências recentes e detalhes técnicos</summary>
                <ul className="mt-3 flex flex-col gap-3">
                  {g.slice(0, 8).map((r) => (
                    <li key={r.id} className="rounded-xl border border-border p-3">
                      <p className="text-xs text-muted">
                        {formatDateTime(r.created_at)} · {r.user_id ? (emails.get(r.user_id) ?? "conta apagada") : "visitante sem login"} · {r.browser} ·{" "}
                        {r.os} · {r.device} · {r.route}
                      </p>
                      {Object.keys(r.context ?? {}).length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1">
                          {Object.entries(r.context).map(([k, v]) => (
                            <span key={k} className="rounded bg-white/6 px-1.5 py-0.5 font-mono text-[11px] text-muted">
                              {k}: {String(v)}
                            </span>
                          ))}
                        </div>
                      )}
                      {r.stack && (
                        <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-black/30 p-2 text-[11px] text-subtle">
                          {r.stack}
                        </pre>
                      )}
                    </li>
                  ))}
                </ul>
              </details>
            </Card>
          </li>
        ))}
      </ul>
    </div>
  );
}
