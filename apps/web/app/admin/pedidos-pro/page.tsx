import Link from "next/link";
import { requireAdmin, supabaseAdmin } from "@/lib/supabase/server";
import { Card } from "@/components/ui/card";
import { ProStatusBadge } from "@/components/pro/pro-status";
import { formatDate } from "@/lib/cn";
import { ServiceEditor } from "./service-editor";

export const metadata = { title: "Mixagem Profissional" };

export default async function AdminProOrders() {
  await requireAdmin();
  const admin = supabaseAdmin();
  const [{ data: orders }, { data: services }, { data: authList }] = await Promise.all([
    admin
      .from("pro_orders")
      .select("id, project_name, status, created_at, due_date, user_id, profiles(display_name)")
      .order("created_at", { ascending: false })
      .limit(200),
    admin.from("pro_services").select("id, name, description, price_brl, delivery_days, max_revisions, max_stems, active").order("position"),
    admin.auth.admin.listUsers({ page: 1, perPage: 1000 }),
  ]);
  const emails = new Map((authList?.users ?? []).map((u) => [u.id, u.email ?? ""]));
  const open = (orders ?? []).filter((o) => ["paid", "in_progress", "revision_requested"].includes(o.status as string));

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="font-display text-2xl font-semibold">Mixagem Profissional</h1>
        <p className="text-sm text-muted">{open.length} pedido(s) para trabalhar</p>
      </div>

      {(services ?? []).map((s) => (
        <ServiceEditor key={s.id as string} service={s as Parameters<typeof ServiceEditor>[0]["service"]} />
      ))}

      <Card className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
          <thead className="text-left text-xs text-subtle">
            <tr className="border-b border-border">
              <th className="px-4 py-3 font-normal">Música</th>
              <th className="px-4 py-3 font-normal">Cliente</th>
              <th className="px-4 py-3 font-normal">Pedido</th>
              <th className="px-4 py-3 font-normal">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {(orders ?? []).map((o) => (
              <tr key={o.id as string} className="hover:bg-white/[0.03]">
                <td className="px-4 py-3">
                  <Link href={`/admin/pedidos-pro/${o.id}`} className="font-medium text-violet-300 hover:underline">
                    {o.project_name as string}
                  </Link>
                </td>
                <td className="px-4 py-3 text-xs">
                  <p>{(o.profiles as unknown as { display_name: string | null } | null)?.display_name ?? "—"}</p>
                  <p className="text-subtle">{emails.get(o.user_id as string)}</p>
                </td>
                <td className="px-4 py-3 text-xs text-muted">{formatDate(o.created_at as string)}</td>
                <td className="px-4 py-3">
                  <ProStatusBadge status={o.status as string} />
                </td>
              </tr>
            ))}
            {!orders?.length && (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-muted">
                  Nenhum pedido ainda.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
