import { Badge, type Tone } from "@/components/ui/badge";

export const PRO_STATUS: Record<string, { label: string; tone: Tone; hint: string }> = {
  pending_payment: { label: "Aguardando pagamento", tone: "warning", hint: "Conclua o pagamento para o engenheiro começar." },
  paid: { label: "Na fila", tone: "info", hint: "Pagamento aprovado. O engenheiro vai começar em breve." },
  in_progress: { label: "Mixando", tone: "primary", hint: "O engenheiro está trabalhando na sua música." },
  waiting_revision: { label: "Entregue", tone: "success", hint: "Ouça a mixagem e aprove ou peça uma revisão." },
  revision_requested: { label: "Em revisão", tone: "primary", hint: "O engenheiro está fazendo os ajustes pedidos." },
  delivered: { label: "Concluído", tone: "success", hint: "Pedido aprovado. Obrigado!" },
  cancelled: { label: "Cancelado", tone: "danger", hint: "Este pedido foi cancelado." },
  refunded: { label: "Reembolsado", tone: "neutral", hint: "O valor foi devolvido." },
};

export function ProStatusBadge({ status }: { status: string }) {
  const s = PRO_STATUS[status] ?? { label: status, tone: "neutral" as Tone };
  return <Badge tone={s.tone}>{s.label}</Badge>;
}
