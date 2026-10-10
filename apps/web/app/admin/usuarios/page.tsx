import { requireAdmin, supabaseAdmin } from "@/lib/supabase/server";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/cn";
import { AdjustCredits } from "./adjust";
import { BlockButton } from "./block-button";
import { PlanEditor } from "./plan-editor";

export const metadata = { title: "Usuários" };

/** Hora da requisição (a página é renderizada a cada acesso). */
const requestTime = () => Date.now();

export default async function AdminUsers(props: PageProps<"/admin/usuarios">) {
  await requireAdmin();
  const sp = await props.searchParams;
  const q = typeof sp.q === "string" ? sp.q.trim() : "";
  const admin = supabaseAdmin();

  // E-mails vêm do Auth (somente no servidor, após validar admin)
  const { data: authList } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
  const emails = new Map((authList?.users ?? []).map((u) => [u.id, { email: u.email ?? "", confirmed: !!u.email_confirmed_at }]));

  let query = admin.from("profiles").select("id,display_name,role,referral_code,created_at,blocked_at").order("created_at", { ascending: false }).limit(200);
  if (q) {
    const ids = [...emails.entries()].filter(([, v]) => v.email.toLowerCase().includes(q.toLowerCase())).map(([id]) => id);
    query = ids.length ? query.or(`display_name.ilike.%${q.replace(/[%,()]/g, "")}%,id.in.(${ids.join(",")})`) : query.ilike("display_name", `%${q.replace(/[%,()]/g, "")}%`);
  }
  const [{ data: profiles }, { data: balances }, { data: exportsRows }, { data: referred }, { data: grants }, { data: subs }] = await Promise.all([
    query,
    admin.from("credit_balances").select("user_id,balance").eq("kind", "download"),
    admin.from("credit_transactions").select("user_id").eq("type", "DOWNLOAD").limit(50000),
    admin.from("profiles").select("referred_by").not("referred_by", "is", null).limit(50000),
    admin.from("plan_grants").select("user_id,plan_id,expires_at"),
    admin.from("subscriptions").select("user_id,plan_id,last_payment_at").eq("status", "authorized"),
  ]);
  // plano em vigor (mesma regra de public.current_plan): admin > concessão ativa > assinatura > grátis
  const now = requestTime();
  const grantOf = new Map((grants ?? []).map((g) => [g.user_id as string, g as { plan_id: string; expires_at: string }]));
  const subOf = new Map<string, string>();
  for (const s of subs ?? []) {
    if (s.last_payment_at && now - new Date(s.last_payment_at as string).getTime() < 35 * 86_400_000 && subOf.get(s.user_id as string) !== "pro") subOf.set(s.user_id as string, s.plan_id as string);
  }
  const PLAN: Record<string, string> = { pro: "Pro", criador: "Criador" };
  const planOf = (id: string, role: string) => {
    if (role === "admin") return { label: "Pro", detail: "admin", tone: "warning" as const };
    const g = grantOf.get(id);
    if (g && new Date(g.expires_at).getTime() > now) return { label: PLAN[g.plan_id] ?? g.plan_id, detail: `concedido até ${formatDate(g.expires_at)}`, tone: "primary" as const };
    const sub = subOf.get(id);
    if (sub) return { label: PLAN[sub] ?? sub, detail: "assinatura", tone: "success" as const };
    return { label: "Grátis", detail: g ? `concessão terminou em ${formatDate(g.expires_at)}` : "", tone: "neutral" as const };
  };
  const brtDay = (iso: string) => new Date(new Date(iso).getTime() - 3 * 3600_000).toISOString().slice(0, 10);
  const balanceOf = new Map((balances ?? []).map((b) => [b.user_id, b.balance]));
  const countBy = (rows: Record<string, unknown>[] | null, key: string) => {
    const m = new Map<string, number>();
    for (const r of rows ?? []) m.set(r[key] as string, (m.get(r[key] as string) ?? 0) + 1);
    return m;
  };
  const exportsOf = countBy(exportsRows, "user_id");
  const referredOf = countBy(referred, "referred_by");

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-2xl font-semibold">Usuários</h1>
        <form className="flex gap-2">
          <input
            name="q"
            defaultValue={q}
            placeholder="Buscar por nome ou e-mail"
            className="h-10 w-64 rounded-xl border border-border-strong bg-black/20 px-3 text-sm outline-none focus:border-violet-400"
          />
        </form>
      </div>
      <Card className="overflow-x-auto">
        <table className="w-full min-w-[1180px] text-sm">
          <thead className="text-left text-xs text-subtle">
            <tr className="border-b border-border">
              <th className="px-4 py-3 font-normal">Usuário</th>
              <th className="px-4 py-3 font-normal">Cadastro</th>
              <th className="px-4 py-3 font-normal">Código</th>
              <th className="px-4 py-3 font-normal">Plano</th>
              <th className="px-4 py-3 font-normal">Conceder plano até</th>
              <th className="px-4 py-3 font-normal">Créditos</th>
              <th className="px-4 py-3 font-normal">Exportações</th>
              <th className="px-4 py-3 font-normal">Indicou</th>
              <th className="px-4 py-3 font-normal">Ajustar créditos</th>
              <th className="px-4 py-3 font-normal" />
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {(profiles ?? []).map((p) => {
              const e = emails.get(p.id);
              const pl = planOf(p.id, p.role);
              const g = grantOf.get(p.id);
              const activeGrant = g && new Date(g.expires_at).getTime() > now ? { plan: g.plan_id, until: brtDay(g.expires_at) } : null;
              return (
                <tr key={p.id} className={p.blocked_at ? "opacity-50" : ""}>
                  <td className="px-4 py-3">
                    <p className="font-medium">
                      {p.display_name ?? "—"}{" "}
                      {p.role === "admin" && <Badge tone="warning">admin</Badge>}
                      {p.blocked_at && <Badge tone="danger">bloqueado</Badge>}
                    </p>
                    <p className="text-xs text-muted">
                      {e?.email} {e && !e.confirmed && <span className="text-amber-300">(não confirmado)</span>}
                    </p>
                  </td>
                  <td className="px-4 py-3 text-xs text-muted">{formatDate(p.created_at)}</td>
                  <td className="px-4 py-3 font-mono text-xs">{p.referral_code}</td>
                  <td className="px-4 py-3">
                    <Badge tone={pl.tone}>{pl.label}</Badge>
                    {pl.detail && <p className="mt-1 text-[11px] text-muted">{pl.detail}</p>}
                  </td>
                  <td className="px-4 py-3">{p.role === "admin" ? <span className="text-xs text-subtle">sempre Pro</span> : <PlanEditor userId={p.id} grant={activeGrant} />}</td>
                  <td className="px-4 py-3 tabular-nums">{balanceOf.get(p.id) ?? 0}</td>
                  <td className="px-4 py-3 tabular-nums">{exportsOf.get(p.id) ?? 0}</td>
                  <td className="px-4 py-3 tabular-nums">{referredOf.get(p.id) ?? 0}</td>
                  <td className="px-4 py-3">
                    <AdjustCredits userId={p.id} />
                  </td>
                  <td className="px-4 py-3">
                    <BlockButton userId={p.id} blocked={!!p.blocked_at} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
