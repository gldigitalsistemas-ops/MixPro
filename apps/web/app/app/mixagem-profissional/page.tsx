import Link from "next/link";
import { CheckCircle, Clock, Music2, Pencil } from "lucide-react";
import { requireSession, supabaseAdmin, supabaseServer } from "@/lib/supabase/server";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/misc";
import { formatDateTime } from "@/lib/cn";

export const metadata = { title: "Mixagem Profissional" };

const STATUS_LABEL: Record<string, string> = {
  pending_payment: "Aguardando pagamento",
  paid: "Recebido",
  in_progress: "Em andamento",
  waiting_revision: "Entrega disponível",
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

export default async function ProMixingPage() {
  const session = await requireSession("/app/mixagem-profissional");
  const supabase = await supabaseServer();

  const [{ data: orders }, { data: services }] = await Promise.all([
    supabase
      .from("pro_orders")
      .select("id,project_name,status,created_at,due_date,service:pro_services(name,price_brl)")
      .order("created_at", { ascending: false })
      .limit(20),
    supabaseAdmin().from("pro_services").select("*").eq("active", true).order("position"),
  ]);

  const enabled = await supabaseAdmin()
    .from("system_settings")
    .select("value")
    .eq("key", "pro_mixing_enabled")
    .single()
    .then(({ data }) => data?.value === true || data?.value === "true");

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-semibold">Mixagem Profissional</h1>
          <p className="mt-1 text-sm text-muted">
            Tenha sua música mixada manualmente por um engenheiro de áudio.
          </p>
        </div>
        {enabled && (
          <ButtonLink href="/app/mixagem-profissional/pedido">
            <Pencil className="size-4" />
            Novo pedido
          </ButtonLink>
        )}
      </div>

      {/* Serviços disponíveis */}
      {(services ?? []).length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2">
          {(services ?? []).map((svc) => (
            <Card key={svc.id} className="flex flex-col gap-4 p-6">
              <div className="flex items-start gap-3">
                <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary/15">
                  <Music2 className="size-5 text-violet-300" />
                </div>
                <div>
                  <p className="font-semibold">{svc.name}</p>
                  <p className="text-sm text-muted">{svc.description}</p>
                </div>
              </div>
              <ul className="flex flex-col gap-1 text-sm text-muted">
                <li className="flex items-center gap-2">
                  <CheckCircle className="size-3.5 text-green-400" />
                  Até {svc.max_stems} stems (WAV / FLAC / AIFF)
                </li>
                <li className="flex items-center gap-2">
                  <Clock className="size-3.5 text-yellow-400" />
                  Entrega em até {svc.delivery_days} dias úteis
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle className="size-3.5 text-green-400" />
                  {svc.max_revisions} {svc.max_revisions === 1 ? "revisão inclusa" : "revisões inclusas"}
                </li>
              </ul>
              <div className="flex items-center justify-between">
                <p className="font-display text-2xl font-bold">
                  R$&nbsp;{Number(svc.price_brl).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                </p>
                {enabled && (
                  <ButtonLink href={`/app/mixagem-profissional/pedido?service=${svc.id}`} size="sm">
                    Contratar
                  </ButtonLink>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Meus pedidos */}
      <section className="flex flex-col gap-3">
        <h2 className="font-medium">Meus pedidos</h2>
        <Card className="overflow-hidden">
          {(orders ?? []).length === 0 ? (
            <EmptyState icon={<Music2 className="size-6" />} title="Nenhum pedido ainda" />
          ) : (
            <ul className="divide-y divide-border">
              {(orders ?? []).map((o) => (
                <li key={o.id}>
                  <Link href={`/app/mixagem-profissional/pedidos/${o.id}`} className="flex items-center justify-between gap-3 px-5 py-4 hover:bg-white/3">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{o.project_name}</p>
                      <p className="text-xs text-subtle">{formatDateTime(o.created_at)}</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-3">
                      <Badge tone={STATUS_TONE[o.status] ?? "neutral"}>
                        {STATUS_LABEL[o.status] ?? o.status}
                      </Badge>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </section>
    </div>
  );
}
