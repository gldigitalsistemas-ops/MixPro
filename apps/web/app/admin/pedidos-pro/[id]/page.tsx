import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { requireAdmin, supabaseAdmin } from "@/lib/supabase/server";
import { Card } from "@/components/ui/card";
import { ProStatusBadge } from "@/components/pro/pro-status";
import { formatDate, formatDateTime } from "@/lib/cn";
import { AdminOrderActions } from "./actions";

export const metadata = { title: "Pedido profissional" };

export default async function AdminProOrder(props: PageProps<"/admin/pedidos-pro/[id]">) {
  await requireAdmin();
  const { id } = await props.params;
  const admin = supabaseAdmin();
  const { data: o } = await admin.from("pro_orders").select("*, pro_services(name, max_revisions), profiles(display_name)").eq("id", id).maybeSingle();
  if (!o) notFound();
  const [{ data: messages }, { data: user }] = await Promise.all([
    admin.from("pro_messages").select("id, body, is_admin, created_at").eq("order_id", id).order("created_at"),
    admin.auth.admin.getUserById(o.user_id as string),
  ]);
  const svc = o.pro_services as { name: string; max_revisions: number } | null;

  return (
    <div className="flex max-w-3xl flex-col gap-5">
      <Link href="/admin/pedidos-pro" className="flex items-center gap-2 text-sm text-muted hover:text-text">
        <ArrowLeft className="size-4" /> Pedidos
      </Link>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-2xl font-semibold">{o.project_name as string}</h1>
        <ProStatusBadge status={o.status as string} />
      </div>

      <Card className="grid gap-3 p-5 text-sm sm:grid-cols-2">
        <p>
          <span className="block text-xs text-subtle">Cliente</span>
          {(o.profiles as { display_name: string | null } | null)?.display_name ?? "—"} · {user?.user?.email}
        </p>
        <p>
          <span className="block text-xs text-subtle">Serviço</span>
          {svc?.name} · revisões {o.revisions_used as number}/{svc?.max_revisions}
        </p>
        <p>
          <span className="block text-xs text-subtle">Pedido em</span>
          {formatDate(o.created_at as string)}
        </p>
        <p>
          <span className="block text-xs text-subtle">Estilo / BPM</span>
          {(o.genre as string) || "—"} / {(o.bpm as number) || "—"}
        </p>
        {o.notes && <p className="rounded-xl bg-white/5 p-3 text-muted sm:col-span-2">{o.notes as string}</p>}
        {o.revision_notes && (
          <p className="rounded-xl border border-violet-400/30 bg-primary/10 p-3 sm:col-span-2">
            <span className="block text-xs text-subtle">Pedido de revisão</span>
            {o.revision_notes as string}
          </p>
        )}
        {o.files_url && (
          <a href={o.files_url as string} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 break-all text-violet-300 sm:col-span-2">
            <ExternalLink className="size-4 shrink-0" /> Faixas: {o.files_url as string}
          </a>
        )}
      </Card>

      <AdminOrderActions
        orderId={id}
        status={o.status as string}
        deliveryUrl={(o.delivery_url as string) ?? ""}
        adminNotes={(o.admin_notes as string) ?? ""}
        messages={(messages ?? []).map((m) => ({ ...m, when: formatDateTime(m.created_at as string) })) as {
          id: string;
          body: string;
          is_admin: boolean;
          when: string;
        }[]}
      />
    </div>
  );
}
