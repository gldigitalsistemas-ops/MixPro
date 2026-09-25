import { notFound } from "next/navigation";
import { requireAdmin, supabaseAdmin } from "@/lib/supabase/server";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { formatDateTime } from "@/lib/cn";
import { AdminOrderActions } from "./admin-actions";

export const metadata = { title: "Gerenciar pedido" };

export default async function AdminOrderDetailPage(props: PageProps<"/admin/pedidos-pro/[id]">) {
  const { id } = await props.params;
  await requireAdmin();

  const { data: order } = await supabaseAdmin()
    .from("pro_orders")
    .select("*, user:profiles(display_name,id), service:pro_services(name,price_brl,max_revisions), stems:pro_stems(id,file_name,size_bytes,status,synced_at)")
    .eq("id", id)
    .maybeSingle();

  if (!order) notFound();

  const { data: messages } = await supabaseAdmin()
    .from("pro_messages")
    .select("id,body,is_admin,sender_id,created_at")
    .eq("order_id", id)
    .order("created_at");

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <ButtonLink href="/admin/pedidos-pro" variant="ghost" size="sm" className="-ml-2 mb-1">
            ← Todos os pedidos
          </ButtonLink>
          <h1 className="font-display text-xl font-semibold">{order.project_name}</h1>
          <p className="text-sm text-muted">
            {(order.user as Record<string, string>)?.display_name ?? "—"} · {formatDateTime(order.created_at)}
          </p>
        </div>
        <Badge tone="primary">{order.status}</Badge>
      </div>

      {/* Detalhes */}
      <Card className="grid grid-cols-2 gap-x-4 gap-y-2 p-5 text-sm">
        <div><p className="text-muted">Gênero</p><p>{order.genre ?? "—"}</p></div>
        <div><p className="text-muted">BPM</p><p>{order.bpm ?? "—"}</p></div>
        <div><p className="text-muted">Prazo</p><p>{order.due_date ?? "—"}</p></div>
        <div><p className="text-muted">Revisões usadas</p><p>{order.revisions_used} / {(order.service as Record<string,number>)?.max_revisions}</p></div>
        {order.notes && (
          <div className="col-span-2">
            <p className="text-muted">Orientações</p>
            <p className="mt-1 whitespace-pre-wrap text-xs">{order.notes}</p>
          </div>
        )}
        {order.revision_notes && (
          <div className="col-span-2">
            <p className="text-muted">Pedido de revisão</p>
            <p className="mt-1 whitespace-pre-wrap text-xs text-yellow-300">{order.revision_notes}</p>
          </div>
        )}
      </Card>

      {/* Stems */}
      <Card className="flex flex-col gap-2 overflow-hidden">
        <p className="px-5 pt-4 font-medium">Stems ({(order.stems as unknown[]).length})</p>
        <ul className="divide-y divide-border">
          {((order.stems as { id: string; file_name: string; size_bytes: number; status: string; synced_at: string | null }[]) ?? []).map((s) => (
            <li key={s.id} className="flex items-center justify-between px-5 py-2.5 text-sm">
              <div>
                <p className="font-medium">{s.file_name}</p>
                <p className="text-xs text-subtle">{(s.size_bytes / 1024 / 1024).toFixed(1)} MB · {s.status}</p>
              </div>
              <span className={s.synced_at ? "text-green-400 text-xs" : "text-subtle text-xs"}>
                {s.synced_at ? `✓ ${formatDateTime(s.synced_at)}` : "Não sincronizado"}
              </span>
            </li>
          ))}
        </ul>
      </Card>

      {/* Ações admin */}
      <AdminOrderActions
        orderId={order.id}
        currentStatus={order.status}
        hasDelivery={!!order.delivery_key}
      />

      {/* Mensagens */}
      <Card className="flex flex-col gap-2 overflow-hidden">
        <p className="px-5 pt-4 font-medium text-sm">Mensagens ({(messages ?? []).length})</p>
        {(messages ?? []).length === 0 ? (
          <p className="px-5 pb-4 text-xs text-subtle">Sem mensagens.</p>
        ) : (
          <ul className="divide-y divide-border">
            {(messages ?? []).map((m) => (
              <li key={m.id} className="px-5 py-2.5 text-sm">
                <p className={m.is_admin ? "text-violet-300 text-xs font-medium" : "text-muted text-xs"}>
                  {m.is_admin ? "Admin" : "Cliente"} · {formatDateTime(m.created_at)}
                </p>
                <p className="mt-0.5 whitespace-pre-wrap">{m.body}</p>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
