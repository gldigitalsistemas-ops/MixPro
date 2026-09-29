"use client";

import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { CalendarCheck, Crown } from "lucide-react";
import { useAccountCtx } from "@/components/account/account-provider";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useToast } from "@/components/ui/toast";
import { supabaseBrowser } from "@/lib/supabase/client";
import { formatDate } from "@/lib/cn";

type Plan = { id: string; name: string; credits: number; price: number };
type Sub = { status: string; credits_per_cycle: number; amount_brl: number; last_payment_at: string | null };

const brl = (v: number) => Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export function PlanCard({ unitPrice }: { unitPrice: number }) {
  const { user, requireLogin, refresh } = useAccountCtx();
  const toast = useToast();
  const params = useSearchParams();
  const [plan, setPlan] = useState<Plan | null>(null);
  const [sub, setSub] = useState<Sub | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    supabaseBrowser()
      .from("system_settings")
      .select("value")
      .eq("key", "subscription_plans")
      .maybeSingle()
      .then(({ data }) => Array.isArray(data?.value) && setPlan((data!.value as Plan[])[0] ?? null));
  }, []);

  const loadSub = useCallback(async () => {
    const { data } = await supabaseBrowser()
      .from("subscriptions")
      .select("status, credits_per_cycle, amount_brl, last_payment_at")
      .in("status", ["authorized", "paused"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    setSub((data as Sub) ?? null);
  }, []);

  useEffect(() => {
    if (!user) return;
    const t = setTimeout(() => void loadSub(), 0);
    return () => clearTimeout(t);
  }, [user, loadSub]);

  // Volta da autorização no Mercado Pago: ativa o plano e credita a 1ª cobrança
  useEffect(() => {
    if (!user || params.get("assinatura") !== "retorno") return;
    let tries = 0;
    let stop = false;
    const tick = async () => {
      const res = await fetch("/api/subscriptions/confirm", { method: "POST" }).catch(() => null);
      const status = res?.ok ? (await res.json()).status : null;
      await Promise.all([loadSub(), refresh()]);
      if (!stop && status !== "authorized" && ++tries < 12) setTimeout(tick, 5000);
    };
    void tick();
    return () => {
      stop = true;
    };
  }, [user, params, loadSub, refresh]);

  async function subscribe() {
    if (!plan || !(await requireLogin("Crie sua conta para assinar o plano mensal."))) return;
    setBusy(true);
    try {
      const res = await fetch("/api/subscriptions/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan_id: plan.id }),
      });
      const body = await res.json();
      if (!res.ok || !body.init_point) throw new Error(body.error ?? "Não foi possível abrir a assinatura.");
      void supabaseBrowser().rpc("track_event", { p_event: "checkout_start", p_props: { kind: "plano" } });
      window.location.href = body.init_point;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível abrir a assinatura.");
      setBusy(false);
    }
  }

  async function cancel() {
    if (!window.confirm("Cancelar o plano mensal? Os créditos que você já recebeu continuam na sua conta.")) return;
    setBusy(true);
    const res = await fetch("/api/subscriptions/cancel", { method: "POST" });
    setBusy(false);
    if (!res.ok) return toast.error("Não foi possível cancelar agora. Tente de novo.");
    toast.success("Plano cancelado. Não haverá novas cobranças.");
    void loadSub();
  }

  if (!plan) return null;
  const savings = Math.round((1 - plan.price / (plan.credits * unitPrice)) * 100);

  if (sub?.status === "authorized") {
    return (
      <Card className="flex flex-col gap-3 border-violet-400/40 p-5">
        <p className="flex items-center gap-2 font-display text-lg font-semibold">
          <Crown className="size-5 text-amber-300" /> {plan.name} ativo
        </p>
        <p className="text-sm text-muted">
          {sub.credits_per_cycle} créditos entram todo mês, com cobrança automática de {brl(sub.amount_brl)}.
          {sub.last_payment_at && ` Última cobrança em ${formatDate(sub.last_payment_at)}.`}
        </p>
        <Button variant="ghost" size="sm" className="self-start" onClick={cancel} loading={busy}>
          Cancelar plano
        </Button>
      </Card>
    );
  }

  return (
    <Card className="relative flex flex-col gap-4 overflow-hidden border-violet-400/40 p-5">
      <div aria-hidden className="absolute -right-10 -top-10 size-40 rounded-full bg-primary/30 blur-3xl" />
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="flex items-center gap-2 font-display text-lg font-semibold">
            <Crown className="size-5 text-amber-300" /> {plan.name}
          </p>
          <p className="text-sm text-muted">Para quem posta todo dia.</p>
        </div>
        {savings > 0 && <span className="rounded-full bg-success/15 px-2.5 py-1 text-xs font-semibold text-green-300">-{savings}%</span>}
      </div>
      <p>
        <span className="font-display text-3xl font-bold">{brl(plan.price)}</span>
        <span className="text-sm text-muted"> /mês</span>
      </p>
      <ul className="flex flex-col gap-1.5 text-sm">
        <li className="flex items-center gap-2">
          <CalendarCheck className="size-4 text-violet-300" /> {plan.credits} créditos todo mês ({brl(plan.price / plan.credits)} cada)
        </li>
        <li className="flex items-center gap-2">
          <CalendarCheck className="size-4 text-violet-300" /> Créditos acumulam de um mês para o outro
        </li>
        <li className="flex items-center gap-2">
          <CalendarCheck className="size-4 text-violet-300" /> Cancele quando quiser, sem multa
        </li>
      </ul>
      <Button size="lg" onClick={subscribe} loading={busy}>
        Assinar {plan.name}
      </Button>
      <p className="text-xs text-subtle">Cobrança mensal automática no cartão pelo Mercado Pago.</p>
    </Card>
  );
}
