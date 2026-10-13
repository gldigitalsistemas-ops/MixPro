"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { PremiumCatalog } from "@mixpro/contracts";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useToast } from "@/components/ui/toast";
import { supabaseBrowser } from "@/lib/supabase/client";

const num = (v: string) => (v.trim() === "" ? null : Number(v.replace(",", ".")));

/**
 * Preços e ofertas (Admin): preço da 1ª experiência (uma vez por pessoa), preço profissional, liga/desliga,
 * desconto do Plano Pro, valor do crédito, presente da vitrine e prévias grátis por dia. Vale na hora.
 */
export function PremiumPricesEditor({ catalog, reward, previews }: { catalog: PremiumCatalog; reward: number; previews: number }) {
  const toast = useToast();
  const router = useRouter();
  const [items, setItems] = useState(catalog.items.map((i) => ({ ...i, introText: i.intro_brl === null ? "" : String(i.intro_brl), priceText: String(i.price_brl) })));
  const [pro, setPro] = useState(String(catalog.pro_discount_pct));
  const [credit, setCredit] = useState(String(catalog.credit_brl));
  const [rewardText, setReward] = useState(String(reward));
  const [previewText, setPreviews] = useState(String(previews));
  const [busy, setBusy] = useState(false);

  async function save() {
    const out = items.map((i) => {
      const { introText, priceText, ...rest } = i;
      return { ...rest, intro_brl: num(introText), price_brl: num(priceText) ?? i.price_brl };
    });
    if (out.some((i) => !(i.price_brl > 0) || (i.intro_brl !== null && !(i.intro_brl > 0)))) return toast.error("Confira os preços (use números, ex.: 49.90).");
    setBusy(true);
    const sb = supabaseBrowser();
    const now = new Date().toISOString();
    const r = await Promise.all([
      sb.from("system_settings").update({ value: { credit_brl: num(credit) ?? 1, pro_discount_pct: num(pro) ?? 20, items: out }, updated_at: now }).eq("key", "premium_products"),
      sb.from("system_settings").update({ value: Math.max(0, Math.round(num(rewardText) ?? 10)), updated_at: now }).eq("key", "showcase_reward_credits"),
      sb.from("system_settings").update({ value: Math.max(0, Math.round(num(previewText) ?? 6)), updated_at: now }).eq("key", "premium_preview_per_day"),
    ]);
    setBusy(false);
    if (r.some((x) => x.error)) return toast.error("Não foi possível salvar.");
    toast.success("Preços salvos. Já valem para todos.");
    router.refresh();
  }

  const input = "h-9 w-24 rounded-lg border border-border-strong bg-black/20 px-2 text-sm tabular-nums";
  return (
    <Card className="flex flex-col gap-4 p-5">
      <div>
        <h2 className="font-display text-lg font-semibold">Preços e ofertas</h2>
        <p className="text-sm text-muted">
          1ª experiência: preço de lançamento, uma vez por pessoa (travado por conta, aparelho, CPF e rede). Deixe vazio para não oferecer. Sugestão de preço
          profissional: metade do valor de mercado.
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[620px] text-sm">
          <thead className="text-left text-xs text-subtle">
            <tr>
              <th className="py-2 font-normal">Produto</th>
              <th className="font-normal">1ª experiência (R$)</th>
              <th className="font-normal">Profissional (R$)</th>
              <th className="font-normal">Ativo</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {items.map((it, k) => (
              <tr key={it.id}>
                <td className="py-2">
                  <input value={it.name} onChange={(e) => setItems((x) => x.map((y, j) => (j === k ? { ...y, name: e.target.value } : y)))} className="h-9 w-56 rounded-lg border border-border-strong bg-black/20 px-2 text-sm" />
                </td>
                <td>
                  <input inputMode="decimal" value={it.introText} placeholder="sem oferta" onChange={(e) => setItems((x) => x.map((y, j) => (j === k ? { ...y, introText: e.target.value } : y)))} className={input} />
                </td>
                <td>
                  <input inputMode="decimal" value={it.priceText} onChange={(e) => setItems((x) => x.map((y, j) => (j === k ? { ...y, priceText: e.target.value } : y)))} className={input} />
                </td>
                <td>
                  <input type="checkbox" checked={it.enabled} onChange={(e) => setItems((x) => x.map((y, j) => (j === k ? { ...y, enabled: e.target.checked } : y)))} className="size-4 accent-violet-500" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
        <label className="flex flex-col gap-1">
          Desconto do Plano Pro (%)
          <input inputMode="decimal" value={pro} onChange={(e) => setPro(e.target.value)} className={input} />
        </label>
        <label className="flex flex-col gap-1">
          Valor do crédito (R$) no VS Premium
          <input inputMode="decimal" value={credit} onChange={(e) => setCredit(e.target.value)} className={input} />
        </label>
        <label className="flex flex-col gap-1">
          Presente da vitrine (créditos)
          <input inputMode="numeric" value={rewardText} onChange={(e) => setReward(e.target.value)} className={input} />
        </label>
        <label className="flex flex-col gap-1">
          Prévias grátis por pessoa/dia
          <input inputMode="numeric" value={previewText} onChange={(e) => setPreviews(e.target.value)} className={input} />
        </label>
      </div>
      <Button className="self-start" onClick={() => void save()} loading={busy}>
        Salvar preços
      </Button>
    </Card>
  );
}
