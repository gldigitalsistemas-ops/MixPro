"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useToast } from "@/components/ui/toast";
import { PRO_STATUS } from "@/components/pro/pro-status";
import { supabaseBrowser } from "@/lib/supabase/client";
import { cn } from "@/lib/cn";

type Msg = { id: string; body: string; is_admin: boolean; when: string };

const input = "h-10 min-w-0 flex-1 rounded-xl border border-border-strong bg-black/20 px-3 text-sm outline-none focus:border-violet-400";

export function AdminOrderActions(props: { orderId: string; status: string; deliveryUrl: string; adminNotes: string; messages: Msg[] }) {
  const toast = useToast();
  const router = useRouter();
  const [status, setStatus] = useState(props.status);
  const [delivery, setDelivery] = useState(props.deliveryUrl);
  const [notes, setNotes] = useState(props.adminNotes);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  async function update(patch: Record<string, unknown>, ok: string) {
    setBusy("save");
    const res = await fetch("/api/pro/admin/order", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ order_id: props.orderId, ...patch }),
    });
    setBusy(null);
    const body = await res.json().catch(() => ({}));
    if (!res.ok) return toast.error(body.error ?? "Erro ao salvar.");
    toast.success(ok);
    router.refresh();
  }

  async function send() {
    const body = msg.trim();
    if (!body) return;
    setBusy("msg");
    const sb = supabaseBrowser();
    const { data } = await sb.auth.getUser();
    const { error } = await sb.from("pro_messages").insert({ order_id: props.orderId, sender_id: data.user!.id, body, is_admin: true });
    setBusy(null);
    if (error) return toast.error("Erro ao enviar.");
    setMsg("");
    router.refresh();
  }

  return (
    <>
      <Card className="flex flex-col gap-4 p-5">
        <h2 className="font-medium">Andamento</h2>
        <div className="flex gap-2">
          <select value={status} onChange={(e) => setStatus(e.target.value)} className={input}>
            {["paid", "in_progress", "waiting_revision", "delivered", "cancelled", "refunded"].map((s) => (
              <option key={s} value={s}>
                {PRO_STATUS[s]?.label ?? s}
              </option>
            ))}
          </select>
          <Button variant="secondary" loading={busy === "save"} onClick={() => update({ status }, "Status atualizado.")}>
            Salvar
          </Button>
        </div>
        <div className="flex flex-col gap-1.5 text-sm">
          Link da entrega (Drive, WeTransfer…)
          <div className="flex gap-2">
            <input value={delivery} onChange={(e) => setDelivery(e.target.value)} placeholder="https://" className={input} />
            <Button
              onClick={() =>
                /^https:\/\//i.test(delivery)
                  ? update({ delivery_url: delivery }, "Entrega registrada. O cliente já pode ouvir.")
                  : toast.error("O link precisa começar com https://")
              }
              loading={busy === "save"}
            >
              Entregar
            </Button>
          </div>
          <span className="text-xs text-subtle">Ao entregar, o pedido passa para “Entregue” e o cliente pode aprovar ou pedir revisão.</span>
        </div>
        <label className="flex flex-col gap-1.5 text-sm">
          Anotações internas (o cliente não vê)
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            className="w-full rounded-xl border border-border-strong bg-black/20 p-3 text-sm outline-none focus:border-violet-400"
          />
          <Button variant="ghost" size="sm" className="self-start" onClick={() => update({ admin_notes: notes }, "Anotações salvas.")}>
            Salvar anotações
          </Button>
        </label>
      </Card>

      <Card className="flex flex-col gap-3 p-5">
        <h2 className="font-medium">Conversa com o cliente</h2>
        <ul className="flex max-h-96 flex-col gap-2 overflow-y-auto">
          {props.messages.map((m) => (
            <li
              key={m.id}
              className={cn("max-w-[85%] rounded-2xl px-3 py-2 text-sm", m.is_admin ? "self-end bg-primary/25" : "self-start bg-white/8")}
            >
              <p className="whitespace-pre-wrap">{m.body}</p>
              <p className="mt-1 text-[10px] text-subtle">
                {m.is_admin ? "Você" : "Cliente"} · {m.when}
              </p>
            </li>
          ))}
        </ul>
        <div className="flex gap-2">
          <input value={msg} onChange={(e) => setMsg(e.target.value)} placeholder="Responder o cliente" className={input} />
          <Button onClick={send} loading={busy === "msg"} aria-label="Enviar">
            <Send className="size-4" />
          </Button>
        </div>
      </Card>
    </>
  );
}
