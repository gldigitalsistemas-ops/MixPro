import Link from "next/link";
import { Download, Receipt, ShoppingCart } from "lucide-react";
import { supabaseServer } from "@/lib/supabase/server";
import { getBalance, getPublicSetting } from "@/lib/queries";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/misc";
import { formatDateTime } from "@/lib/cn";
import { RedownloadButton } from "./redownload";

export const metadata = { title: "Meus downloads" };

const TX_LABEL: Record<string, string> = {
  FREE_SIGNUP: "Boas-vindas",
  DOWNLOAD: "Download",
  REFERRAL_BONUS: "Indicação",
  PURCHASE: "Compra",
  ADMIN_ADJUSTMENT: "Ajuste",
  REFUND: "Estorno",
  CAMPAIGN_BONUS: "Bônus",
};

type Grant = {
  id: string;
  created_at: string;
  file: { id: string; original_name: string | null; status: string; deleted_at: string | null } | null;
};

export default async function DownloadsPage() {
  const supabase = await supabaseServer();
  const [balance, price, { data: grants }, { data: txs }] = await Promise.all([
    getBalance(),
    getPublicSetting<number>("download_price_brl", 1),
    supabase
      .from("download_grants")
      .select("id,created_at,file:audio_files(id,original_name,status,deleted_at)")
      .order("created_at", { ascending: false })
      .limit(100),
    supabase.from("credit_transactions").select("id,type,amount,reason,created_at").eq("kind", "download").order("created_at", { ascending: false }).limit(50),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <h1 className="font-display text-2xl font-semibold">Meus downloads</h1>

      <Card className="flex flex-col gap-4 p-6 md:flex-row md:items-center md:justify-between">
        <div>
          <p className="text-sm text-muted">Downloads disponíveis</p>
          <p className="text-gradient font-display text-4xl font-bold tabular-nums">{balance}</p>
        </div>
        <div className="flex flex-col gap-3 md:items-end">
          <p className="text-sm text-muted">
            R$ {Number(price).toLocaleString("pt-BR", { minimumFractionDigits: 2 })} por download adicional · PIX e cartão
          </p>
          <ButtonLink href="/app/creditos/comprar" size="sm">
            <ShoppingCart className="size-4" />
            Comprar créditos
          </ButtonLink>
        </div>
      </Card>

      <section className="flex flex-col gap-3">
        <h2 className="font-medium">Arquivos baixados</h2>
        <Card className="overflow-hidden">
          {(grants ?? []).length === 0 ? (
            <EmptyState icon={<Download className="size-6" />} title="Nenhum download ainda" />
          ) : (
            <ul className="divide-y divide-border">
              {((grants ?? []) as unknown as Grant[]).map((g) => (
                <li key={g.id} className="flex items-center justify-between gap-3 px-5 py-3 text-sm">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{g.file?.original_name ?? "Arquivo"}</p>
                    <p className="text-xs text-subtle">{formatDateTime(g.created_at)}</p>
                  </div>
                  {g.file && !g.file.deleted_at && g.file.status === "ready" ? (
                    <RedownloadButton fileId={g.file.id} />
                  ) : (
                    <span className="text-right text-xs text-subtle">
                      Expirado — gere de novo no projeto
                      <br />
                      (sem nova cobrança)
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-medium">Extrato de créditos</h2>
        <Card className="overflow-hidden">
          {(txs ?? []).length === 0 ? (
            <EmptyState icon={<Receipt className="size-6" />} title="Sem movimentações" />
          ) : (
            <ul className="divide-y divide-border">
              {(txs ?? []).map((t) => (
                <li key={t.id} className="flex items-center justify-between gap-3 px-5 py-3 text-sm">
                  <div>
                    <Badge tone={t.amount > 0 ? "success" : "neutral"}>{TX_LABEL[t.type] ?? t.type}</Badge>
                    <p className="mt-1 text-xs text-subtle">
                      {formatDateTime(t.created_at)} · {t.reason}
                    </p>
                  </div>
                  <span className={t.amount > 0 ? "font-semibold text-green-300" : "text-muted"}>
                    {t.amount > 0 ? `+${t.amount}` : t.amount}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </section>
    </div>
  );
}
