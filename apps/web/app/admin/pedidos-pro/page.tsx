import Link from "next/link";
import { requireAdmin, supabaseAdmin } from "@/lib/supabase/server";
import { Card } from "@/components/ui/card";
import { Badge, type Tone } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/misc";
import { formatDateTime } from "@/lib/cn";
import { Music2 } from "lucide-react";

export const metadata = { title: "Pedidos profissionais" };

const STATUS_LABEL: Record<string, string> = {
  pending_payment: "Ag. pagamento",
  paid: "Pago",
  in_progress: "Em andamento",
  waiting_revision: "Aguardando revisão",
  revision_requested: "Revisão solicitada",
  delivered: "Entregue",
  cancelled: "Cancelado",
  refunded: "Estornado",
};

const STATUS_TONE: Record<string, Tone> = {
  pending_payment: "warning",
  paid: "info",
  in_progress: "primary",
  waiting_revision: "success",
  revision_requested: "warning",
  delivered: "success",
  cancelled: "danger",
  refunded: "neutral",
};

export default async function ProOrdersAdminPage() {
  await requireAdmin();

  const { data: orders } = await supabaseAdmin()
    .from("pro_orders")
    .select("id,project_name,status,created_at,due_date,user:profiles(display_name,id),service:pro_services(name)")
    .order("created_at", { ascending: false })
    .limit(100);

  return (
    <div className="flex flex-col gap-6">
      <h1 className="font-display text-2xl font-semibold">Pedidos de Mixagem Profissional</h1>
      <Card className="overflow-hidden">
        {(orders ?? []).length === 0 ? (
          <EmptyState icon={<Music2 className="size-6" />} title="Nenhum pedido ainda" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted">
                  <th className="px-5 py-3 font-medium">Projeto</th>
                  <th className="px-5 py-3 font-medium">Cliente</th>
                  <th className="px-5 py-3 font-medium">Prazo</th>
                  <th className="px-5 py-3 font-medium">Status</th>
                  <th className="px-5 py-3 font-medium">Criado</th>
                  <th className="px-5 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {(orders ?? []).map((o) => (
                  <tr key={o.id} className="hover:bg-white/2">
                    <td className="px-5 py-3 font-medium">{o.project_name}</td>
                    <td className="px-5 py-3 text-muted">{(o.user as unknown as Record<string,string> | null)?.display_name ?? "—"}</td>
                    <td className="px-5 py-3 text-muted">{o.due_date ?? "—"}</td>
                    <td className="px-5 py-3">
                      <Badge tone={STATUS_TONE[o.status] ?? "neutral"}>
                        {STATUS_LABEL[o.status] ?? o.status}
                      </Badge>
                    </td>
                    <td className="px-5 py-3 text-muted">{formatDateTime(o.created_at)}</td>
                    <td className="px-5 py-3">
                      <Link href={`/admin/pedidos-pro/${o.id}`} className="text-xs text-violet-400 hover:text-violet-300">
                        Gerenciar →
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
