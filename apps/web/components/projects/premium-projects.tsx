"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ChevronRight, Clock, Sparkles } from "lucide-react";
import { Badge, type Tone } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { formatDateTime } from "@/lib/cn";
import { supabaseBrowser } from "@/lib/supabase/client";
import { PRODUCT_NAME } from "@/components/premium/project-view";
import { daysLeft, expiringSoon } from "@/lib/premium/expiry";

type Row = { id: string; product: string; title: string; status: string; created_at: string; expires_at: string };

const STATUS: Record<string, { label: string; tone: Tone }> = {
  draft: { label: "Enviando", tone: "neutral" },
  uploaded: { label: "Enviado", tone: "neutral" },
  preview: { label: "Fazendo a prévia", tone: "primary" },
  preview_ready: { label: "Prévia pronta", tone: "info" },
  awaiting_payment: { label: "Aguardando pagamento", tone: "warning" },
  paid: { label: "Pago", tone: "primary" },
  processing: { label: "Processando", tone: "primary" },
  delivered: { label: "Entregue", tone: "success" },
  failed: { label: "Não concluído", tone: "danger" },
  expired: { label: "Expirado", tone: "neutral" },
};

/** Projetos de produção (Mix & Master IA, Produção, Voz finalizada, VS Premium). */
export function PremiumProjectsList() {
  const [rows, setRows] = useState<Row[]>([]);
  useEffect(() => {
    void supabaseBrowser()
      .from("premium_projects")
      .select("id,product,title,status,created_at,expires_at")
      .order("created_at", { ascending: false })
      .limit(50)
      .then(({ data, error }) => !error && setRows((data ?? []) as Row[]));
  }, []);
  if (!rows.length) return null;
  const soon = rows.filter((r) => expiringSoon(r.status, r.expires_at));
  return (
    <section className="flex flex-col gap-2">
      {soon.length > 0 && (
        <p className="flex items-start gap-2 rounded-2xl border border-amber-400/40 bg-amber-400/10 p-3 text-sm text-amber-100">
          <Clock className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>
            {soon.length === 1 ? "1 projeto tem" : `${soon.length} projetos têm`} arquivos que saem do ar em até 3 dias. Abra e baixe agora: depois disso os arquivos são apagados.
          </span>
        </p>
      )}
      <h2 className="flex items-center gap-2 text-sm font-semibold text-muted">
        <Sparkles className="size-4 text-amber-300" aria-hidden /> Produção
      </h2>
      <ul className="flex flex-col gap-2">
        {rows.map((r) => {
          const st = STATUS[r.status] ?? { label: r.status, tone: "neutral" as Tone };
          return (
            <li key={r.id}>
              <Link href={`/premium/${r.id}`}>
                <Card className="flex items-center gap-3 p-4 transition hover:border-violet-400/50">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">{r.title || "Projeto"}</p>
                    <p className="text-xs text-muted">
                      {PRODUCT_NAME[r.product] ?? r.product} · {formatDateTime(r.created_at)}
                    </p>
                    {expiringSoon(r.status, r.expires_at) && <p className="text-xs font-medium text-amber-300">Arquivos saem do ar {daysLeft(r.expires_at) <= 0 ? "hoje" : `em ${daysLeft(r.expires_at)} dia${daysLeft(r.expires_at) > 1 ? "s" : ""}`}: baixe agora</p>}
                  </div>
                  <Badge tone={st.tone}>{st.label}</Badge>
                  <ChevronRight className="size-4 text-muted" aria-hidden />
                </Card>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
