"use client";

import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { CheckCircle2, Clock, Coins, Minus, Plus, XCircle } from "lucide-react";
import { useAccountCtx } from "@/components/account/account-provider";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useToast } from "@/components/ui/toast";
import { supabaseBrowser } from "@/lib/supabase/client";
import { cn, formatDateTime } from "@/lib/cn";
import { watchPaymentReturn } from "@/lib/pay-client";
import { PlanCard } from "./plan-card";

type Tx = { id: string; type: string; amount: number; reason: string | null; created_at: string };
type Config = { price: number; sizes: number[]; min: number; max: number };

const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export function CreditsView() {
  const { user, account, refresh, requireLogin } = useAccountCtx();
  const toast = useToast();
  const params = useSearchParams();
  const status = params.get("pagamento");
  const [config, setConfig] = useState<Config>({ price: 1, sizes: [5, 10, 15, 30, 50, 100], min: 5, max: 500 });
  const [qty, setQty] = useState(15);
  const [paying, setPaying] = useState(false);
  const [history, setHistory] = useState<Tx[]>([]);

  useEffect(() => {
    supabaseBrowser()
      .from("system_settings")
      .select("key, value")
      .in("key", ["download_price_brl", "credit_pack_sizes", "credit_purchase_min", "credit_purchase_max"])
      .then(({ data }) => {
        if (!data) return;
        const v = Object.fromEntries(data.map((r) => [r.key, r.value]));
        setConfig((c) => ({
          price: Number(v.download_price_brl ?? c.price),
          sizes: Array.isArray(v.credit_pack_sizes) ? (v.credit_pack_sizes as number[]) : c.sizes,
          min: Number(v.credit_purchase_min ?? c.min),
          max: Number(v.credit_purchase_max ?? c.max),
        }));
      });
  }, []);

  const loadHistory = useCallback(async () => {
    const { data } = await supabaseBrowser()
      .from("credit_transactions")
      .select("id, type, amount, reason, created_at")
      .order("created_at", { ascending: false })
      .limit(30);
    setHistory((data as Tx[]) ?? []);
  }, []);

  useEffect(() => {
    if (!user) return;
    const t = setTimeout(() => void loadHistory(), 0);
    return () => clearTimeout(t);
  }, [user, loadHistory]);

  // Na volta do Mercado Pago: confere o pagamento na hora e atualiza o saldo
  const paymentId = params.get("payment_id");
  useEffect(() => {
    if (!user || (status !== "sucesso" && status !== "pendente")) return;
    return watchPaymentReturn(paymentId, () => {
      void refresh();
      void loadHistory();
    });
  }, [status, paymentId, user, refresh, loadHistory]);

  const clamp = (v: number) => Math.max(config.min, Math.min(config.max, Math.round(v) || config.min));

  async function buy() {
    if (!(await requireLogin("Crie sua conta para comprar créditos."))) return;
    setPaying(true);
    void supabaseBrowser().rpc("track_event", { p_event: "checkout_start", p_props: { kind: "creditos", credits: clamp(qty) } });
    try {
      const res = await fetch("/api/payments/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ credits: clamp(qty) }),
      });
      const body = await res.json();
      if (!res.ok || !body.init_point) throw new Error(body.error ?? "Não foi possível abrir o pagamento.");
      window.location.href = body.init_point;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível abrir o pagamento.");
      setPaying(false);
    }
  }

  const banner =
    status === "sucesso"
      ? { icon: CheckCircle2, tone: "border-success/30 bg-success/10 text-green-200", text: "Pagamento aprovado! Seus créditos aparecem aqui em alguns segundos." }
      : status === "pendente"
        ? { icon: Clock, tone: "border-warning/30 bg-warning/10 text-amber-200", text: "Pagamento em processamento. Assim que for aprovado os créditos entram automaticamente." }
        : status === "erro"
          ? { icon: XCircle, tone: "border-danger/30 bg-danger/10 text-red-200", text: "O pagamento não foi concluído. Você pode tentar de novo." }
          : null;

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <h1 className="font-display text-2xl font-semibold">Créditos</h1>

      {banner && (
        <p className={cn("flex items-start gap-3 rounded-2xl border p-4 text-sm", banner.tone)}>
          <banner.icon className="mt-0.5 size-5 shrink-0" /> {banner.text}
        </p>
      )}

      <Card className="flex items-center gap-4 p-5">
        <span className="grid size-14 place-items-center rounded-2xl bg-amber-400/15">
          <Coins className="size-7 text-amber-300" />
        </span>
        <div>
          <p className="font-display text-3xl font-bold tabular-nums">{user ? (account?.balance ?? "…") : "—"}</p>
          <p className="text-sm text-muted">{user ? "créditos disponíveis · 1 crédito = 1 download" : "Entre para ver seu saldo"}</p>
        </div>
      </Card>

      <PlanCard unitPrice={config.price} />

      <Card className="flex flex-col gap-5 p-5">
        <div>
          <h2 className="font-display text-lg font-semibold">Comprar créditos avulsos</h2>
          <p className="text-sm text-muted">
            {brl(config.price)} por crédito. Pague com PIX, cartão ou boleto pelo Mercado Pago. Sem assinatura.
          </p>
        </div>
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
          {config.sizes.map((n) => (
            <button
              key={n}
              type="button"
              aria-pressed={qty === n}
              onClick={() => setQty(n)}
              className={cn(
                "flex flex-col items-center rounded-2xl border py-3 transition",
                qty === n ? "border-violet-400 bg-primary/15" : "border-border hover:bg-white/5",
              )}
            >
              <span className="font-display text-xl font-bold">{n}</span>
              <span className="text-[11px] text-muted">{brl(n * config.price)}</span>
            </button>
          ))}
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm text-muted">Ou escolha:</span>
          <div className="flex items-center rounded-full border border-border-strong">
            <button type="button" aria-label="Menos" className="grid size-10 place-items-center" onClick={() => setQty((q) => clamp(q - 1))}>
              <Minus className="size-4" />
            </button>
            <input
              type="number"
              inputMode="numeric"
              min={config.min}
              max={config.max}
              value={qty}
              onChange={(e) => setQty(Number(e.target.value))}
              onBlur={() => setQty((q) => clamp(q))}
              aria-label="Quantidade de créditos"
              className="h-10 w-16 bg-transparent text-center font-semibold tabular-nums outline-none"
            />
            <button type="button" aria-label="Mais" className="grid size-10 place-items-center" onClick={() => setQty((q) => clamp(q + 1))}>
              <Plus className="size-4" />
            </button>
          </div>
        </div>
        <Button size="lg" onClick={buy} loading={paying}>
          Pagar {brl(clamp(qty) * config.price)} · {clamp(qty)} créditos
        </Button>
        <p className="text-xs text-subtle">
          Você será levado ao ambiente seguro do Mercado Pago e volta para cá depois do pagamento.
        </p>
      </Card>

      {user && history.length > 0 && (
        <Card className="p-5">
          <h2 className="mb-3 font-display text-lg font-semibold">Histórico</h2>
          <ul className="divide-y divide-border">
            {history.map((t) => (
              <li key={t.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                <span className="min-w-0">
                  <span className="block truncate">{t.reason ?? t.type}</span>
                  <span className="text-xs text-subtle">{formatDateTime(t.created_at)}</span>
                </span>
                <span className={cn("font-semibold tabular-nums", t.amount > 0 ? "text-green-300" : "text-muted")}>
                  {t.amount > 0 ? `+${t.amount}` : t.amount}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
