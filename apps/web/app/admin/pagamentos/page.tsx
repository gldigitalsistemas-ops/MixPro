import { requireAdmin, supabaseAdmin } from "@/lib/supabase/server";
import { Badge, type Tone } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { formatDateTime } from "@/lib/cn";

export const metadata = { title: "Pagamentos" };

const STATUS: Record<string, { label: string; tone: Tone }> = {
  pending: { label: "Pendente", tone: "warning" },
  approved: { label: "Aprovado", tone: "success" },
  failed: { label: "Falhou", tone: "danger" },
  cancelled: { label: "Cancelado", tone: "neutral" },
  refunded: { label: "Estornado", tone: "neutral" },
};

const brl = (v: number) => Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export default async function AdminPayments() {
  await requireAdmin();
  const admin = supabaseAdmin();
  const [{ data: orders }, { data: authList }] = await Promise.all([
    admin.from("payment_orders").select("id, user_id, pack_id, amount_brl, credits_amount, status, created_at").order("created_at", { ascending: false }).limit(300),
    admin.auth.admin.listUsers({ page: 1, perPage: 1000 }),
  ]);
  const emails = new Map((authList?.users ?? []).map((u) => [u.id, u.email ?? ""]));
  const approved = (orders ?? []).filter((o) => o.status === "approved");
  const month = new Date();
  month.setDate(1);
  month.setHours(0, 0, 0, 0);
  const sum = (list: typeof approved) => list.reduce((n, o) => n + Number(o.amount_brl), 0);
  const thisMonth = approved.filter((o) => new Date(o.created_at as string) >= month);

  return (
    <div className="flex flex-col gap-6">
      <h1 className="font-display text-2xl font-semibold">Pagamentos</h1>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[
          ["Recebido no mês", brl(sum(thisMonth))],
          ["Pagamentos no mês", thisMonth.length],
          ["Recebido (últimos 300)", brl(sum(approved))],
          ["Mixagens pagas", approved.filter((o) => (o.pack_id as string).startsWith("pro:")).length],
        ].map(([l, v]) => (
          <Card key={l as string} className="p-4">
            <p className="text-xs text-muted">{l}</p>
            <p className="mt-1 font-display text-2xl font-semibold tabular-nums">{v}</p>
          </Card>
        ))}
      </div>
      <Card className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
          <thead className="text-left text-xs text-subtle">
            <tr className="border-b border-border">
              <th className="px-4 py-3 font-normal">Data</th>
              <th className="px-4 py-3 font-normal">Cliente</th>
              <th className="px-4 py-3 font-normal">Item</th>
              <th className="px-4 py-3 font-normal">Valor</th>
              <th className="px-4 py-3 font-normal">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {(orders ?? []).map((o) => {
              const s = STATUS[o.status as string] ?? { label: o.status as string, tone: "neutral" as Tone };
              const pro = (o.pack_id as string).startsWith("pro:");
              return (
                <tr key={o.id as string}>
                  <td className="px-4 py-3 text-xs text-muted">{formatDateTime(o.created_at as string)}</td>
                  <td className="px-4 py-3 text-xs">{emails.get(o.user_id as string)}</td>
                  <td className="px-4 py-3">{pro ? "Mixagem profissional" : `${o.credits_amount} créditos`}</td>
                  <td className="px-4 py-3 tabular-nums">{brl(o.amount_brl as number)}</td>
                  <td className="px-4 py-3">
                    <Badge tone={s.tone}>{s.label}</Badge>
                  </td>
                </tr>
              );
            })}
            {!orders?.length && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-muted">
                  Nenhum pagamento ainda.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
