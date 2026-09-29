"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useToast } from "@/components/ui/toast";
import { supabaseBrowser } from "@/lib/supabase/client";

type Service = {
  id: string;
  name: string;
  description: string | null;
  price_brl: number;
  delivery_days: number;
  max_revisions: number;
  max_stems: number;
  active: boolean;
};

const input = "h-10 w-full rounded-xl border border-border-strong bg-black/20 px-3 text-sm outline-none focus:border-violet-400";

export function ServiceEditor({ service }: { service: Service }) {
  const toast = useToast();
  const [s, setS] = useState(service);
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    const { error } = await supabaseBrowser()
      .from("pro_services")
      .update({
        name: s.name,
        description: s.description,
        price_brl: Number(s.price_brl),
        delivery_days: Number(s.delivery_days),
        max_revisions: Number(s.max_revisions),
        max_stems: Number(s.max_stems),
        active: s.active,
      })
      .eq("id", s.id);
    setSaving(false);
    if (error) toast.error("Não foi possível salvar o serviço.");
    else toast.success("Serviço atualizado.");
  }

  const num = (k: keyof Service) => (e: React.ChangeEvent<HTMLInputElement>) => setS({ ...s, [k]: e.target.value });

  return (
    <Card className="flex flex-col gap-3 p-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-medium">Serviço oferecido</h2>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={s.active} onChange={(e) => setS({ ...s, active: e.target.checked })} className="accent-violet-500" />
          Ativo
        </label>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-xs text-muted">
          Nome
          <input value={s.name} onChange={(e) => setS({ ...s, name: e.target.value })} className={input} />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted">
          Preço (R$)
          <input type="number" step="0.01" min="1" value={s.price_brl} onChange={num("price_brl")} className={input} />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted">
          Prazo (dias)
          <input type="number" min="1" value={s.delivery_days} onChange={num("delivery_days")} className={input} />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted">
          Revisões inclusas
          <input type="number" min="0" value={s.max_revisions} onChange={num("max_revisions")} className={input} />
        </label>
      </div>
      <label className="flex flex-col gap-1 text-xs text-muted">
        Descrição
        <textarea
          value={s.description ?? ""}
          onChange={(e) => setS({ ...s, description: e.target.value })}
          rows={2}
          className="w-full rounded-xl border border-border-strong bg-black/20 p-3 text-sm text-text outline-none focus:border-violet-400"
        />
      </label>
      <Button onClick={save} loading={saving} className="self-start">
        Salvar serviço
      </Button>
    </Card>
  );
}
