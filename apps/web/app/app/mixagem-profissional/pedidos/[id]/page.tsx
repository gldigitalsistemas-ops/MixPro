import { notFound } from "next/navigation";
import { requireSession, supabaseServer } from "@/lib/supabase/server";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { formatDateTime } from "@/lib/cn";
import { OrderActions } from "./order-actions";
import { OrderChat } from "./order-chat";

export async function generateMetadata(props: PageProps<"/app/mixagem-profissional/pedidos/[id]">) {
  return { title: "Pedido de mixagem" };
}

const STATUS_LABEL: Record<string, string> = {
  pending_payment: "Aguardando pagamento",
  paid: "Recebido — em breve iniciaremos",
  in_progress: "Mixagem em andamento",
  waiting_revision: "Entrega disponível para download",
  revision_requested: "Revisão solicitada",
  delivered: "Concluído",
  cancelled: "Cancelado",
  refunded: "Estornado",
};

const STATUS_TONE: Record<string, "neutral" | "warning" | "primary" | "success" | "info" | "danger"> = {
  pending_payment: "warning",
  paid: "info",
  in_progress: "primary",
  waiting_revision: "success",
  revision_requested: "warning",
  delivered: "success",
  cancelled: "danger",
  refunded: "neutral",
};

export default async function OrderDetailPage(props: PageProps<"/app/mixagem-profissional/pedidos/[id]">) {
  const { id } = await props.params;
  await requireSession(`/app/mixagem-profissional/pedidos/${id}`);
  const supabase = await supabaseServer();

  const { data: order } = await supabase
    .from("pro_orders")
    .select("*, service:pro_services(name,price_brl,max_revisions), stems:pro_stems(id,file_name,size_bytes,status)")
    .eq("id", id)
    .maybeSingle();

  if (!order) notFound();

  const { data: messages } = await supabase
    .from("pro_messages")
    .select("id,body,is_admin,sender_id,created_at")
    .eq("order_id", id)
    .order("created_at");

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <ButtonLink href="/app/mixagem-profissional" variant="ghost" size="sm" className="-ml-2 mb-1">
            ← Meus pedidos
          </ButtonLink>
          <h1 className="font-display text-xl font-semibold">{order.project_name}</h1>
          <p className="text-sm text-muted">{formatDateTime(order.created_at)}</p>
        </div>
        <Badge tone={STATUS_TONE[order.status] ?? "neutral"}>
          {STATUS_LABEL[order.status] ?? order.status}
        </Badge>
      </div>

      {/* Pagamento pendente */}
      {order.status === "pending_payment" && (
        <Card className="flex flex-col gap-3 p-5">
          <p className="font-medium">Finalizar pagamento</p>
          <p className="text-sm text-muted">
            Valor:{" "}
            <strong className="text-text">
              R$ {Number((order.service as Record<string, unknown>)?.price_brl ?? 0).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
            </strong>
          </p>
          <ButtonLink href={`/app/creditos/comprar?redirect=pro&order=${order.id}`}>
            Pagar agora
          </ButtonLink>
        </Card>
      )}

      {/* Detalhes */}
      <Card className="flex flex-col gap-3 p-5 text-sm">
        <div className="grid grid-cols-2 gap-x-4 gap-y-2">
          <div><p className="text-muted">Serviço</p><p className="font-medium">{(order.service as Record<string,unknown>)?.name as string}</p></div>
          <div><p className="text-muted">Prazo</p><p className="font-medium">{order.due_date ?? "—"}</p></div>
          {order.genre && <div><p className="text-muted">Gênero</p><p>{order.genre}</p></div>}
          {order.bpm && <div><p className="text-muted">BPM</p><p>{order.bpm}</p></div>}
        </div>
        {order.notes && (
          <div>
            <p className="text-muted">Orientações</p>
            <p className="mt-1 whitespace-pre-wrap text-xs">{order.notes}</p>
          </div>
        )}
      </Card>

      {/* Stems */}
      <Card className="flex flex-col gap-2 overflow-hidden">
        <p className="px-5 pt-4 font-medium">Stems enviados ({(order.stems as unknown[]).length})</p>
        <ul className="divide-y divide-border">
          {((order.stems as { id: string; file_name: string; size_bytes: number; status: string }[]) ?? []).map((s) => (
            <li key={s.id} className="flex items-center justify-between px-5 py-2.5 text-sm">
              <span className="truncate">{s.file_name}</span>
              <span className={s.status === "ready" ? "text-green-400 text-xs" : "text-muted text-xs"}>
                {s.status === "ready" ? "✓" : s.status}
              </span>
            </li>
          ))}
        </ul>
      </Card>

      {/* Ações do cliente */}
      <OrderActions order={{ id: order.id, status: order.status, delivery_key: order.delivery_key, revisions_used: order.revisions_used, max_revisions: (order.service as Record<string, unknown>)?.max_revisions as number }} />

      {/* Chat */}
      <OrderChat orderId={order.id} initialMessages={(messages ?? []) as { id: string; body: string; is_admin: boolean; sender_id: string; created_at: string }[]} />
    </div>
  );
}
