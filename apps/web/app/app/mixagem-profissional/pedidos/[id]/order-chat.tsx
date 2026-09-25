"use client";

import { useEffect, useRef, useState } from "react";
import { Send } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { cn } from "@/lib/cn";

type Message = { id: string; body: string; is_admin: boolean; sender_id: string; created_at: string };

export function OrderChat({ orderId, initialMessages }: { orderId: string; initialMessages: Message[] }) {
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const supabase = supabaseBrowser();

  useEffect(() => {
    const channel = supabase
      .channel(`pro_messages:${orderId}`)
      .on("postgres_changes", {
        event: "INSERT",
        schema: "public",
        table: "pro_messages",
        filter: `order_id=eq.${orderId}`,
      }, (payload: { new: Message }) => {
        setMessages((prev) => [...prev, payload.new]);
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [orderId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function send() {
    const body = text.trim();
    if (!body) return;
    setSending(true);
    setText("");
    const { error } = await supabase.from("pro_messages").insert({ order_id: orderId, body });
    if (error) setText(body);
    setSending(false);
  }

  return (
    <div className="flex flex-col gap-2 rounded-2xl border border-border overflow-hidden">
      <p className="px-5 pt-4 font-medium text-sm">Mensagens</p>
      <div className="flex flex-col gap-2 max-h-72 overflow-y-auto px-4 pb-2">
        {messages.length === 0 && (
          <p className="text-center text-xs text-subtle py-4">Nenhuma mensagem ainda. Tire suas dúvidas aqui.</p>
        )}
        {messages.map((m) => (
          <div key={m.id} className={cn("flex", m.is_admin ? "justify-start" : "justify-end")}>
            <div className={cn(
              "max-w-[80%] rounded-2xl px-4 py-2 text-sm",
              m.is_admin ? "bg-bg-elev text-text rounded-tl-sm" : "bg-brand text-white rounded-tr-sm"
            )}>
              {m.is_admin && <p className="text-[10px] text-subtle mb-1">Engenheiro de áudio</p>}
              <p className="whitespace-pre-wrap">{m.body}</p>
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
      <div className="flex gap-2 border-t border-border px-4 py-3">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && (e.preventDefault(), send())}
          placeholder="Escreva uma mensagem…"
          disabled={sending}
          className="flex-1 bg-transparent text-sm outline-none placeholder:text-subtle"
        />
        <button
          onClick={send}
          disabled={!text.trim() || sending}
          className="text-primary disabled:opacity-40 hover:brightness-125"
          aria-label="Enviar"
        >
          <Send className="size-4" />
        </button>
      </div>
    </div>
  );
}
