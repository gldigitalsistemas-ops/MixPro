"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowLeft, Check, Download, ExternalLink, Send } from "lucide-react";
import { useAccountCtx } from "@/components/account/account-provider";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useToast } from "@/components/ui/toast";
import { supabaseBrowser } from "@/lib/supabase/client";
import { cn, formatDate, formatDateTime } from "@/lib/cn";
import { PRO_STATUS, ProStatusBadge } from "./pro-status";

type Order = {
  id: string;
  project_name: string;
  genre: string | null;
  bpm: number | null;
  notes: string | null;
  status: string;
  files_url: string | null;
  delivery_url: string | null;
  revisions_used: number;
  revision_notes: string | null;
  due_date: string | null;
  created_at: string;
  pro_services: { name: string; max_revisions: number; delivery_days: number } | null;
};
type Message = { id: string; body: string; is_admin: boolean; created_at: string };

export function OrderView({ id }: { id: string }) {
  const { user } = useAccountCtx();
  const toast = useToast();
  const params = useSearchParams();
  const [order, setOrder] = useState<Order | null>(null);
  const [missing, setMissing] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [text, setText] = useState("");
  const [revision, setRevision] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const sb = supabaseBrowser();
    const [{ data: o }, { data: m }] = await Promise.all([
      sb.from("pro_orders").select("*, pro_services(name, max_revisions, delivery_days)").eq("id", id).maybeSingle(),
      sb.from("pro_messages").select("id, body, is_admin, created_at").eq("order_id", id).order("created_at"),
    ]);
    if (!o) setMissing(true);
    else setOrder(o as Order);
    setMessages((m as Message[]) ?? []);
  }, [id]);

  useEffect(() => {
    if (!user) return;
    const first = setTimeout(() => void load(), 0);
    // acompanha a confirmação do pagamento e respostas do engenheiro
    const t = setInterval(() => void load(), 15000);
    return () => {
      clearTimeout(first);
      clearInterval(t);
    };
  }, [user, load]);

  async function act(name: string, fn: () => PromiseLike<{ error: unknown }>, ok: string) {
    setBusy(name);
    const { error } = await fn();
    setBusy(null);
    if (error) toast.error("Não foi possível concluir. Tente novamente.");
    else {
      toast.success(ok);
      await load();
    }
  }

  async function pay() {
    setBusy("pay");
    const res = await fetch(`/api/pro/orders/${id}/pay`, { method: "POST" });
    const body = await res.json().catch(() => ({}));
    if (res.ok && body.init_point) window.location.href = body.init_point;
    else {
      setBusy(null);
      toast.error(body.error ?? "Não foi possível abrir o pagamento.");
    }
  }

  if (!user) return <p className="py-12 text-center text-sm text-muted">Entre na sua conta para ver o pedido.</p>;
  if (missing) return <p className="py-12 text-center text-sm text-muted">Pedido não encontrado.</p>;
  if (!order) return <p className="py-12 text-center text-sm text-muted">Carregando…</p>;

  const st = PRO_STATUS[order.status];
  const svc = order.pro_services;
  const canEditFiles = ["pending_payment", "paid", "revision_requested"].includes(order.status);
  const delivered = ["waiting_revision", "revision_requested", "delivered"].includes(order.status) && order.delivery_url;
  const revisionsLeft = (svc?.max_revisions ?? 0) - order.revisions_used;

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-5">
      <Link href="/mixagem-profissional" className="flex items-center gap-2 text-sm text-muted hover:text-text">
        <ArrowLeft className="size-4" /> Mixagem Profissional
      </Link>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-2xl font-semibold">{order.project_name}</h1>
        <ProStatusBadge status={order.status} />
      </div>

      {params.get("pagamento") === "sucesso" && order.status === "pending_payment" && (
        <p className="rounded-2xl border border-success/30 bg-success/10 p-4 text-sm text-green-200">
          Recebemos seu pagamento! A confirmação chega em instantes e o pedido entra na fila automaticamente.
        </p>
      )}

      <Card className="flex flex-col gap-3 p-5">
        <p className="text-sm">{st?.hint}</p>
        {order.status === "pending_payment" && (
          <Button onClick={pay} loading={busy === "pay"}>
            Pagar agora
          </Button>
        )}
        <dl className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <dt className="text-xs text-subtle">Serviço</dt>
            <dd>{svc?.name}</dd>
          </div>
          <div>
            <dt className="text-xs text-subtle">Pedido em</dt>
            <dd>{formatDate(order.created_at)}</dd>
          </div>
          {order.genre && (
            <div>
              <dt className="text-xs text-subtle">Estilo</dt>
              <dd>{order.genre}</dd>
            </div>
          )}
          {order.bpm && (
            <div>
              <dt className="text-xs text-subtle">BPM</dt>
              <dd>{order.bpm}</dd>
            </div>
          )}
        </dl>
        {order.notes && <p className="rounded-xl bg-white/5 p-3 text-sm text-muted">{order.notes}</p>}
      </Card>

      <Card className="flex flex-col gap-3 p-5">
        <h2 className="font-display text-lg font-semibold">Suas faixas</h2>
        {order.files_url && (
          <a href={order.files_url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 break-all text-sm text-violet-300">
            <ExternalLink className="size-4 shrink-0" /> {order.files_url}
          </a>
        )}
        {canEditFiles && (
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              const url = String(new FormData(e.currentTarget).get("url")).trim();
              if (!/^https:\/\//i.test(url)) return toast.error("O link precisa começar com https://");
              void act("files", () => supabaseBrowser().rpc("update_pro_files", { p_order_id: id, p_files_url: url }), "Link atualizado.");
            }}
          >
            <input
              name="url"
              type="url"
              placeholder="Trocar o link das faixas"
              className="h-10 min-w-0 flex-1 rounded-xl border border-border-strong bg-black/20 px-3 text-sm outline-none focus:border-violet-400"
            />
            <Button variant="secondary" size="sm" type="submit" loading={busy === "files"}>
              Salvar
            </Button>
          </form>
        )}
      </Card>

      {delivered && (
        <Card className="flex flex-col gap-4 border-success/30 p-5">
          <h2 className="font-display text-lg font-semibold">Sua mixagem</h2>
          <a href={order.delivery_url!} target="_blank" rel="noopener noreferrer">
            <Button className="w-full">
              <Download className="size-4" /> Ouvir e baixar a mixagem
            </Button>
          </a>
          {order.status === "waiting_revision" && (
            <>
              <Button
                variant="secondary"
                loading={busy === "approve"}
                onClick={() => act("approve", () => supabaseBrowser().rpc("approve_delivery", { p_order_id: id }), "Mixagem aprovada. Obrigado!")}
              >
                <Check className="size-4" /> Aprovar mixagem
              </Button>
              {revisionsLeft > 0 ? (
                <div className="flex flex-col gap-2">
                  <textarea
                    value={revision}
                    onChange={(e) => setRevision(e.target.value)}
                    rows={3}
                    maxLength={2000}
                    placeholder="O que você gostaria de mudar?"
                    className="w-full rounded-xl border border-border-strong bg-black/20 p-3 text-sm outline-none focus:border-violet-400"
                  />
                  <Button
                    variant="ghost"
                    disabled={revision.trim().length < 5}
                    loading={busy === "revision"}
                    onClick={() =>
                      act(
                        "revision",
                        () => supabaseBrowser().rpc("request_revision", { p_order_id: id, p_notes: revision.trim() }),
                        "Revisão pedida. O engenheiro já foi avisado.",
                      )
                    }
                  >
                    Pedir revisão ({revisionsLeft} restante{revisionsLeft > 1 ? "s" : ""})
                  </Button>
                </div>
              ) : (
                <p className="text-xs text-subtle">As revisões inclusas já foram usadas.</p>
              )}
            </>
          )}
        </Card>
      )}

      <Card className="flex flex-col gap-3 p-5">
        <h2 className="font-display text-lg font-semibold">Conversa com o engenheiro</h2>
        {messages.length ? (
          <ul className="flex max-h-80 flex-col gap-2 overflow-y-auto">
            {messages.map((m) => (
              <li
                key={m.id}
                className={cn(
                  "max-w-[85%] rounded-2xl px-3 py-2 text-sm",
                  m.is_admin ? "self-start bg-white/8" : "self-end bg-primary/25",
                )}
              >
                <p className="whitespace-pre-wrap">{m.body}</p>
                <p className="mt-1 text-[10px] text-subtle">
                  {m.is_admin ? "Engenheiro" : "Você"} · {formatDateTime(m.created_at)}
                </p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted">Mande referências ou tire dúvidas por aqui.</p>
        )}
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const body = text.trim();
            if (!body) return;
            setText("");
            void act(
              "msg",
              () => supabaseBrowser().from("pro_messages").insert({ order_id: id, sender_id: user.id, body: body.slice(0, 2000) }),
              "Mensagem enviada.",
            );
          }}
        >
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Escreva uma mensagem"
            maxLength={2000}
            className="h-11 min-w-0 flex-1 rounded-xl border border-border-strong bg-black/20 px-3 text-sm outline-none focus:border-violet-400"
          />
          <Button type="submit" aria-label="Enviar" loading={busy === "msg"}>
            <Send className="size-4" />
          </Button>
        </form>
      </Card>
    </div>
  );
}
