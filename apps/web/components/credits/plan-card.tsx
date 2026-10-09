"use client";

import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { CalendarCheck, Crown, Sparkles } from "lucide-react";
import { useAccountCtx } from "@/components/account/account-provider";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useToast } from "@/components/ui/toast";
import { supabaseBrowser } from "@/lib/supabase/client";
import { cn, formatDate } from "@/lib/cn";

type Plan = { id: string; name: string; credits: number; price: number; perks?: string[] };
type Sub = { plan_id: string; status: string; credits_per_cycle: number; amount_brl: number; last_payment_at: string | null };

const brl = (v: number) => Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const TAGLINE: Record<string, string> = { criador: "Para quem posta todo dia.", pro: "Para músicos e produtores: tudo do estúdio, sem limite de formato." };

/** Planos mensais (Criador e Pro). Com um plano ativo, mostra o plano e o cancelamento. */
export function PlanCard({ unitPrice }: { unitPrice: number }) {
  const { user, requireLogin, refresh } = useAccountCtx();
  const toast = useToast();
  const params = useSearchParams();
  const [plans, setPlans] = useState<Plan[]>([]);
  const [sub, setSub] = useState<Sub | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    supabaseBrowser()
      .from("system_settings")
      .select("value")
      .eq("key", "subscription_plans")
      .maybeSingle()
      .then(({ data }) => Array.isArray(data?.value) && setPlans(data!.value as Plan[]));
  }, []);

  const loadSub = useCallback(async () => {
    const { data } = await supabaseBrowser()
      .from("subscriptions")
      .select("plan_id, status, credits_per_cycle, amount_brl, last_payment_at")
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

  async function subscribe(plan: Plan) {
    if (!(await requireLogin("Crie sua conta para assinar um plano mensal."))) return;
    setBusy(plan.id);
    try {
      const res = await fetch("/api/subscriptions/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan_id: plan.id }),
      });
      const body = await res.json();
      if (!res.ok || !body.init_point) throw new Error(body.error ?? "Não foi possível abrir a assinatura.");
      void supabaseBrowser().rpc("track_event", { p_event: "checkout_start", p_props: { kind: "plano", plano: plan.id } });
      window.location.assign(body.init_point);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível abrir a assinatura.");
      setBusy(null);
    }
  }

  async function cancel() {
    if (!window.confirm("Cancelar o plano mensal? Os créditos que você já recebeu continuam na sua conta.")) return;
    setBusy("cancel");
    const res = await fetch("/api/subscriptions/cancel", { method: "POST" });
    setBusy(null);
    if (!res.ok) return toast.error("Não foi possível cancelar agora. Tente de novo.");
    toast.success("Plano cancelado. Não haverá novas cobranças.");
    void loadSub();
  }

  if (!plans.length) return null;

  if (sub?.status === "authorized") {
    const plan = plans.find((p) => p.id === sub.plan_id);
    return (
      <Card className="flex flex-col gap-3 border-violet-400/40 p-5">
        <p className="flex items-center gap-2 font-display text-lg font-semibold">
          <Crown className="size-5 text-amber-300" /> {plan?.name ?? "Plano"} ativo
        </p>
        <p className="text-sm text-muted">
          {sub.credits_per_cycle} créditos entram todo mês, com cobrança automática de {brl(sub.amount_brl)}.
          {sub.last_payment_at && ` Última cobrança em ${formatDate(sub.last_payment_at)}.`}
        </p>
        {plan?.perks && (
          <ul className="flex flex-col gap-1 text-sm">
            {plan.perks.map((p) => (
              <li key={p} className="flex items-center gap-2">
                <Sparkles className="size-4 text-amber-300" /> {p}
              </li>
            ))}
          </ul>
        )}
        <p className="text-xs text-subtle">Para trocar de plano, cancele o atual e assine o novo: os créditos que você tem continuam na conta.</p>
        <Button variant="ghost" size="sm" className="self-start" onClick={cancel} loading={busy === "cancel"}>
          Cancelar plano
        </Button>
      </Card>
    );
  }

  return (
    <div className={cn("grid gap-4", plans.length > 1 && "md:grid-cols-2")}>
      {plans.map((plan) => {
        const savings = Math.round((1 - plan.price / (plan.credits * unitPrice)) * 100);
        const pro = plan.id === "pro";
        return (
          <Card key={plan.id} className={cn("relative flex flex-col gap-4 overflow-hidden p-5", pro ? "border-amber-400/50" : "border-violet-400/40")}>
            <div aria-hidden className={cn("absolute -right-10 -top-10 size-40 rounded-full blur-3xl", pro ? "bg-amber-400/20" : "bg-primary/30")} />
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="flex items-center gap-2 font-display text-lg font-semibold">
                  <Crown className={cn("size-5", pro ? "text-amber-300" : "text-violet-300")} /> {plan.name}
                </p>
                <p className="text-sm text-muted">{TAGLINE[plan.id] ?? ""}</p>
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
              {(plan.perks ?? []).map((p) => (
                <li key={p} className="flex items-center gap-2">
                  <Sparkles className="size-4 text-amber-300" /> {p}
                </li>
              ))}
              <li className="flex items-center gap-2">
                <CalendarCheck className="size-4 text-violet-300" /> Créditos acumulam · cancele quando quiser
              </li>
            </ul>
            <Button size="lg" onClick={() => void subscribe(plan)} loading={busy === plan.id} className="mt-auto">
              Assinar {plan.name}
            </Button>
          </Card>
        );
      })}
      <p className="text-xs text-subtle md:col-span-2">Cobrança mensal automática no cartão pelo Mercado Pago.</p>
    </div>
  );
}
