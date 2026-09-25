import { requireAdmin, supabaseAdmin } from "@/lib/supabase/server";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/cn";
import { AdjustCredits } from "./adjust";
import { BlockButton } from "./block-button";

export const metadata = { title: "Usuários" };

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
  const [{ data: profiles }, { data: balances }] = await Promise.all([
    query,
    admin.from("credit_balances").select("user_id,balance").eq("kind", "download"),
  ]);
  const balanceOf = new Map((balances ?? []).map((b) => [b.user_id, b.balance]));

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
        <table className="w-full min-w-[720px] text-sm">
          <thead className="text-left text-xs text-subtle">
            <tr className="border-b border-border">
              <th className="px-4 py-3 font-normal">Usuário</th>
              <th className="px-4 py-3 font-normal">Cadastro</th>
              <th className="px-4 py-3 font-normal">Código</th>
              <th className="px-4 py-3 font-normal">Downloads</th>
              <th className="px-4 py-3 font-normal">Ajustar créditos</th>
              <th className="px-4 py-3 font-normal" />
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {(profiles ?? []).map((p) => {
              const e = emails.get(p.id);
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
                  <td className="px-4 py-3 tabular-nums">{balanceOf.get(p.id) ?? 0}</td>
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
