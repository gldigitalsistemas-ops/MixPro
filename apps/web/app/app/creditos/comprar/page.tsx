import { Check, Zap } from "lucide-react";
import { supabaseAdmin } from "@/lib/supabase/server";
import { getBalance } from "@/lib/queries";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/cn";
import { BuyButton } from "./buy-button";
import type { CreditPack } from "@/lib/payments";

export const metadata = { title: "Comprar créditos" };

const PERKS = [
  "PIX com aprovação imediata",
  "Cartão de crédito",
  "Créditos não expiram",
  "Re-download gratuito",
];

export default async function BuyCreditsPage() {
  const [balance, { data: setting }] = await Promise.all([
    getBalance(),
    supabaseAdmin().from("system_settings").select("value").eq("key", "credit_packs").single(),
  ]);

  const packs = ((setting?.value ?? []) as CreditPack[]).sort((a, b) => a.credits - b.credits);

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="font-display text-2xl font-semibold">Comprar créditos</h1>
        <p className="mt-1 text-sm text-muted">
          Você tem <span className="font-semibold text-text">{balance} download{balance !== 1 ? "s" : ""}</span> disponíve{balance !== 1 ? "is" : "l"}.
        </p>
      </div>

      {/* Pacotes */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {packs.map((pack) => (
          <Card
            key={pack.id}
            className={cn(
              "relative flex flex-col gap-5 p-6 transition",
              pack.highlight && "border-primary/60 ring-1 ring-primary/30",
            )}
          >
            {pack.badge && (
              <Badge tone="primary" className="absolute -top-3 left-1/2 -translate-x-1/2">
                {pack.badge}
              </Badge>
            )}

            <div>
              <p className="text-sm text-muted">{pack.label}</p>
              <p className="font-display text-3xl font-bold">
                R$&nbsp;{pack.brl.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
              </p>
              <p className="mt-1 text-xs text-subtle">
                ≈ R$&nbsp;{(pack.brl / pack.credits).toLocaleString("pt-BR", { minimumFractionDigits: 2 })} por download
              </p>
            </div>

            <ul className="flex flex-col gap-1.5 text-sm text-muted">
              <li className="flex items-center gap-2">
                <Zap className="size-4 text-primary" />
                <span className="font-semibold text-text">{pack.credits} downloads</span>
              </li>
              {PERKS.map((p) => (
                <li key={p} className="flex items-center gap-2">
                  <Check className="size-3.5 shrink-0 text-green-400" />
                  {p}
                </li>
              ))}
            </ul>

            <BuyButton packId={pack.id} label={`${pack.credits} downloads`} />
          </Card>
        ))}
      </div>

      {/* Segurança / info */}
      <p className="text-center text-xs text-subtle">
        Pagamentos processados pelo Mercado Pago com criptografia SSL.
        Créditos adicionados automaticamente após confirmação do pagamento.
      </p>
    </div>
  );
}
