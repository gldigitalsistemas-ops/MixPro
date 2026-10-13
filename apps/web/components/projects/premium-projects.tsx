"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ChevronRight, Sparkles } from "lucide-react";
import { Badge, type Tone } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { formatDateTime } from "@/lib/cn";
import { supabaseBrowser } from "@/lib/supabase/client";
import { PRODUCT_NAME } from "@/components/premium/project-view";

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
  return (
    <section className="flex flex-col gap-2">
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
