"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CalendarClock, ChevronRight, Headphones, Link2, Mic2, RotateCcw } from "lucide-react";
import { useAccountCtx } from "@/components/account/account-provider";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useToast } from "@/components/ui/toast";
import { supabaseBrowser } from "@/lib/supabase/client";
import { formatDate } from "@/lib/cn";
import { ProStatusBadge } from "./pro-status";

type Service = {
  id: string;
  name: string;
  description: string | null;
  price_brl: number;
  delivery_days: number;
  max_revisions: number;
  max_stems: number;
};
type Order = { id: string; project_name: string; status: string; created_at: string };

const brl = (v: number) => Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const inputCls =
  "h-11 w-full rounded-xl border border-border-strong bg-black/20 px-3 text-sm outline-none focus:border-violet-400";

export function ProView() {
  const { user, requireLogin } = useAccountCtx();
  const toast = useToast();
  const router = useRouter();
  const [services, setServices] = useState<Service[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [serviceId, setServiceId] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    supabaseBrowser()
      .from("pro_services")
      .select("id, name, description, price_brl, delivery_days, max_revisions, max_stems")
      .eq("active", true)
      .order("position")
      .then(({ data }) => {
        setServices((data as Service[]) ?? []);
        if (data?.[0]) setServiceId(data[0].id as string);
      });
  }, []);

  useEffect(() => {
    if (!user) return;
    supabaseBrowser()
      .from("pro_orders")
      .select("id, project_name, status, created_at")
      .order("created_at", { ascending: false })
      .then(({ data }) => setOrders((data as Order[]) ?? []));
  }, [user]);

  const service = services.find((s) => s.id === serviceId);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    if (!(await requireLogin("Crie sua conta para fazer o pedido de mixagem."))) return;
    const files = String(form.get("files_url") ?? "").trim();
    if (!/^https:\/\//i.test(files)) return toast.error("Cole o link dos arquivos (começa com https://).");
    setSending(true);
    try {
      const bpm = Number(form.get("bpm"));
      const res = await fetch("/api/pro/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          service_id: serviceId,
          project_name: String(form.get("project_name")).trim(),
          genre: String(form.get("genre") ?? "").trim() || undefined,
          bpm: bpm >= 40 && bpm <= 300 ? bpm : undefined,
          notes: String(form.get("notes") ?? "").trim() || undefined,
          files_url: files,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Não foi possível criar o pedido.");
      if (body.init_point) window.location.href = body.init_point;
      else router.push(`/mixagem-profissional/pedidos/${body.order_id}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Não foi possível criar o pedido.");
      setSending(false);
    }
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <div>
        <h1 className="font-display text-2xl font-semibold">Mixagem Profissional</h1>
        <p className="text-sm text-muted">Um engenheiro de áudio mixa a sua música à mão, faixa por faixa.</p>
      </div>

      {service && (
        <Card className="relative overflow-hidden p-6">
          <div aria-hidden className="absolute -right-12 -top-12 size-44 rounded-full bg-primary/25 blur-3xl" />
          <div className="flex items-start gap-4">
            <span className="bg-brand grid size-12 shrink-0 place-items-center rounded-2xl text-white">
              <Mic2 className="size-6" />
            </span>
            <div className="flex-1">
              <h2 className="font-display text-xl font-semibold">{service.name}</h2>
              <p className="mt-1 text-sm text-muted">{service.description}</p>
            </div>
          </div>
          <div className="mt-5 grid grid-cols-3 gap-3 text-center">
            <div className="rounded-2xl bg-white/5 p-3">
              <p className="font-display text-xl font-bold">{brl(service.price_brl)}</p>
              <p className="text-[11px] text-muted">por música</p>
            </div>
            <div className="rounded-2xl bg-white/5 p-3">
              <p className="font-display text-xl font-bold">{service.delivery_days} dias</p>
              <p className="text-[11px] text-muted">para entrega</p>
            </div>
            <div className="rounded-2xl bg-white/5 p-3">
              <p className="font-display text-xl font-bold">{service.max_revisions}</p>
              <p className="text-[11px] text-muted">revisões inclusas</p>
            </div>
          </div>
        </Card>
      )}

      <Card className="p-5">
        <h2 className="mb-3 font-display text-lg font-semibold">Como funciona</h2>
        <ol className="grid gap-3 text-sm sm:grid-cols-2">
          {[
            [Link2, "Envie o link das faixas", "Coloque as faixas separadas (voz, violão, bateria…) numa pasta do Google Drive, WeTransfer ou Dropbox e cole o link."],
            [CalendarClock, "Pague com segurança", "PIX, cartão ou boleto pelo Mercado Pago. O prazo começa na aprovação."],
            [Headphones, "Receba a mixagem", "Você recebe o link do arquivo final e conversa com o engenheiro pelo pedido."],
            [RotateCcw, "Peça ajustes", "Não ficou do seu jeito? Peça revisões dentro do limite do serviço."],
          ].map(([Icon, t, d]) => {
            const I = Icon as typeof Link2;
            return (
              <li key={t as string} className="flex gap-3 rounded-2xl border border-border p-3">
                <I className="mt-0.5 size-5 shrink-0 text-violet-300" />
                <span>
                  <span className="block font-medium">{t as string}</span>
                  <span className="text-muted">{d as string}</span>
                </span>
              </li>
            );
          })}
        </ol>
      </Card>

      {service && (
        <Card className="p-5">
          <h2 className="mb-4 font-display text-lg font-semibold">Fazer pedido</h2>
          <form onSubmit={submit} className="flex flex-col gap-4">
            {services.length > 1 && (
              <label className="flex flex-col gap-1.5 text-sm">
                Serviço
                <select value={serviceId ?? ""} onChange={(e) => setServiceId(e.target.value)} className={inputCls}>
                  {services.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} — {brl(s.price_brl)}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label className="flex flex-col gap-1.5 text-sm">
              Nome da música
              <input name="project_name" required maxLength={120} className={inputCls} placeholder="Ex.: Minha Canção" />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="flex flex-col gap-1.5 text-sm">
                Estilo (opcional)
                <input name="genre" maxLength={60} className={inputCls} placeholder="Sertanejo, gospel, trap…" />
              </label>
              <label className="flex flex-col gap-1.5 text-sm">
                BPM (opcional)
                <input name="bpm" type="number" min={40} max={300} className={inputCls} placeholder="120" />
              </label>
            </div>
            <label className="flex flex-col gap-1.5 text-sm">
              Link das faixas
              <input name="files_url" type="url" required className={inputCls} placeholder="https://drive.google.com/…" />
              <span className="text-xs text-subtle">
                Até {service.max_stems} faixas em WAV ou AIFF, todas começando no mesmo ponto. No Google Drive, deixe o
                compartilhamento como “qualquer pessoa com o link”.
              </span>
            </label>
            <label className="flex flex-col gap-1.5 text-sm">
              Como você imagina o som? (opcional)
              <textarea
                name="notes"
                maxLength={2000}
                rows={4}
                className="w-full rounded-xl border border-border-strong bg-black/20 p-3 text-sm outline-none focus:border-violet-400"
                placeholder="Referências de músicas, o que destacar, efeitos na voz…"
              />
            </label>
            <Button type="submit" size="lg" loading={sending}>
              Pagar {brl(service.price_brl)} e enviar pedido
            </Button>
          </form>
        </Card>
      )}

      {orders.length > 0 && (
        <Card className="p-2">
          <h2 className="px-3 pb-1 pt-3 font-display text-lg font-semibold">Meus pedidos</h2>
          {orders.map((o) => (
            <Link
              key={o.id}
              href={`/mixagem-profissional/pedidos/${o.id}`}
              className="flex items-center gap-3 rounded-xl px-3 py-3 text-sm hover:bg-white/5"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{o.project_name}</span>
                <span className="text-xs text-subtle">{formatDate(o.created_at)}</span>
              </span>
              <ProStatusBadge status={o.status} />
              <ChevronRight className="size-4 text-subtle" />
            </Link>
          ))}
        </Card>
      )}
    </div>
  );
}
