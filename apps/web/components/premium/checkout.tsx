"use client";

import { useEffect, useState } from "react";
import { Coins, CreditCard, Gift, ShieldCheck } from "lucide-react";
import type { PremiumId, PremiumQuote } from "@mixpro/contracts";
import { useAccountCtx } from "@/components/account/account-provider";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { brl, checkout, PremiumError, quote } from "@/lib/premium/client";
import { cn } from "@/lib/cn";

type Quotes = { intro: PremiumQuote | null; regular: PremiumQuote | null; introAvailable: boolean };

/** Preço com a oferta da 1ª experiência (preço normal riscado) e o desconto do Plano Pro. */
export function PriceTag({ q, compact }: { q: Quotes | null; compact?: boolean }) {
  if (!q?.regular) return <span className="text-sm text-muted">…</span>;
  const r = q.regular;
  return (
    <span className={cn("flex flex-wrap items-baseline gap-2", compact ? "text-sm" : "")}>
      {q.intro ? (
        <>
          <span className="text-muted line-through">{brl(r.list_price_brl)}</span>
          <strong className={cn("font-display text-emerald-300", compact ? "text-lg" : "text-2xl")}>{brl(q.intro.price_brl)}</strong>
          <span className="rounded-full bg-emerald-400/15 px-2 py-0.5 text-[11px] font-semibold text-emerald-200">1ª experiência</span>
        </>
      ) : (
        <>
          {r.pro_discount && <span className="text-muted line-through">{brl(r.list_price_brl)}</span>}
          <strong className={cn("font-display", compact ? "text-lg" : "text-2xl")}>{brl(r.price_brl)}</strong>
          {r.pro_discount && <span className="rounded-full bg-amber-400/15 px-2 py-0.5 text-[11px] font-semibold text-amber-200">Plano Pro</span>}
        </>
      )}
      {r.long && <span className="text-xs text-muted">(música longa)</span>}
    </span>
  );
}

export function useQuote(product: PremiumId, minutes: number, enabled = true) {
  const { user } = useAccountCtx();
  const [q, setQ] = useState<Quotes | null>(null);
  useEffect(() => {
    if (!user || !enabled) return;
    let alive = true;
    quote(product, minutes)
      .then((r) => alive && setQ(r))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [user, product, minutes, enabled]);
  return q;
}

const maskCpf = (v: string) =>
  v
    .replace(/\D/g, "")
    .slice(0, 11)
    .replace(/(\d{3})(\d)/, "$1.$2")
    .replace(/(\d{3})\.(\d{3})(\d)/, "$1.$2.$3")
    .replace(/(\d{3})\.(\d{3})\.(\d{3})(\d)/, "$1.$2.$3-$4");

/**
 * Pagamento do projeto. A 1ª experiência pede o CPF (só para garantir uma por pessoa; guardamos apenas
 * um código irreversível). Pagamento em reais abre o Mercado Pago (PIX ou cartão); em créditos, na hora.
 */
export function CheckoutDialog(p: { open: boolean; onClose: () => void; projectId: string; product: PremiumId; minutes: number; title: string; onPaid: () => void }) {
  const toast = useToast();
  const { account, refresh, showNoCredits, isAdmin } = useAccountCtx();
  const q = useQuote(p.product, p.minutes, p.open);
  const [useIntro, setUseIntro] = useState(true);
  const [cpf, setCpf] = useState("");
  const [method, setMethod] = useState<"brl" | "credits">("brl");
  const [busy, setBusy] = useState(false);
  const intro = useIntro && Boolean(q?.intro);
  const current = intro ? q?.intro : q?.regular;
  const creditsOk = !intro && current?.credits != null;

  async function pay() {
    if (!current) return;
    if (intro && cpf.replace(/\D/g, "").length !== 11) return toast.error("Informe o CPF para usar o preço da 1ª experiência.");
    setBusy(true);
    try {
      const r = await checkout(p.projectId, { product: p.product, method: creditsOk ? method : "brl", useIntro: intro, cpf: intro ? cpf : undefined });
      if (r.paid) {
        void refresh();
        toast.success("Pago! O trabalho completo já começou.");
        p.onPaid();
        p.onClose();
      } else if (r.init_point) window.location.assign(r.init_point);
    } catch (e) {
      const err = e as PremiumError;
      if (err.code === "INSUFFICIENT_CREDITS") showNoCredits();
      toast.error(err.message);
      if (err.code === "INTRO_USED") setUseIntro(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={p.open} onClose={p.onClose} title={`Finalizar — ${p.title}`}>
      <div className="flex flex-col gap-4">
        {isAdmin ? (
          <>
            <p className="rounded-2xl bg-emerald-400/10 p-3 text-sm text-emerald-100">
              Como administrador, você usa todos os recursos sem pagar. O pedido fica registrado com valor zero.
            </p>
            <Button
              size="lg"
              loading={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await checkout(p.projectId, { product: p.product, method: "credits", useIntro: false });
                  toast.success("Liberado. O trabalho completo já começou.");
                  p.onPaid();
                  p.onClose();
                } catch (e) {
                  toast.error((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              Liberar grátis (admin)
            </Button>
          </>
        ) : !q ? (
          <p className="text-sm text-muted">Calculando o preço…</p>
        ) : (
          <>
            {q.intro && (
              <label className={cn("flex cursor-pointer gap-3 rounded-2xl border p-3", useIntro ? "border-emerald-400/50 bg-emerald-400/5" : "border-border")}>
                <input type="checkbox" checked={useIntro} onChange={(e) => setUseIntro(e.target.checked)} className="mt-1 size-4 accent-emerald-500" />
                <span className="text-sm">
                  <span className="flex items-center gap-2 font-semibold">
                    <Gift className="size-4 text-emerald-300" aria-hidden /> Preço da 1ª experiência: {brl(q.intro.price_brl)}
                  </span>
                  <span className="block text-xs text-muted">
                    Vale uma vez por pessoa (o preço normal é {brl(q.regular?.list_price_brl ?? 0)}). Para garantir isso, pedimos o seu CPF: guardamos só um código
                    irreversível dele, nunca o número.
                  </span>
                </span>
              </label>
            )}
            {intro && (
              <label className="flex flex-col gap-1.5 text-sm">
                CPF
                <input
                  inputMode="numeric"
                  autoComplete="off"
                  value={cpf}
                  onChange={(e) => setCpf(maskCpf(e.target.value))}
                  placeholder="000.000.000-00"
                  className="h-11 rounded-xl border border-border-strong bg-black/20 px-3 outline-none focus:border-violet-400"
                />
              </label>
            )}
            {creditsOk && (
              <div className="grid grid-cols-2 gap-2">
                {(["brl", "credits"] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setMethod(m)}
                    className={cn("flex items-center justify-center gap-2 rounded-2xl border p-3 text-sm", method === m ? "border-violet-400 bg-primary/10" : "border-border")}
                  >
                    {m === "brl" ? <CreditCard className="size-4" aria-hidden /> : <Coins className="size-4 text-amber-300" aria-hidden />}
                    {m === "brl" ? "PIX ou cartão" : `${current?.credits} créditos`}
                  </button>
                ))}
              </div>
            )}
            {creditsOk && method === "credits" && <p className="text-xs text-muted">Você tem {account?.balance ?? 0} créditos.</p>}
            <div className="flex items-center justify-between rounded-2xl bg-white/5 p-3">
              <span className="text-sm text-muted">Total</span>
              <strong className="font-display text-2xl">{creditsOk && method === "credits" ? `${current?.credits} créditos` : brl(current?.price_brl ?? 0)}</strong>
            </div>
            <Button size="lg" onClick={() => void pay()} loading={busy}>
              {creditsOk && method === "credits" ? "Pagar com créditos" : "Ir para o pagamento"}
            </Button>
            <p className="flex items-center gap-2 text-xs text-subtle">
              <ShieldCheck className="size-4" aria-hidden /> Pagamento seguro pelo Mercado Pago. Se algo der errado no processamento, refazemos ou devolvemos o valor.
            </p>
          </>
        )}
      </div>
    </Modal>
  );
}
