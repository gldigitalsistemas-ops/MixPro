"use client";

import { useEffect, useState } from "react";
import { Cpu } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { cn } from "@/lib/cn";

type Status = { online: boolean; queued: number; processing: number };

export function useProcessorStatus(intervalMs = 20000) {
  const [status, setStatus] = useState<Status | null>(null);
  useEffect(() => {
    let alive = true;
    const load = async () => {
      const { data } = await supabaseBrowser().rpc("processor_status");
      if (alive && data) setStatus(data as Status);
    };
    void load();
    const t = setInterval(load, intervalMs);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [intervalMs]);
  return status;
}

export function ProcessorStatus() {
  const s = useProcessorStatus();
  return (
    <div className="flex items-center gap-3" aria-live="polite">
      <div className="grid size-11 place-items-center rounded-xl bg-white/5">
        <Cpu className="size-5 text-muted" aria-hidden />
      </div>
      <div className="text-sm">
        <p className="flex items-center gap-2 font-medium">
          <span
            className={cn("size-2 rounded-full", !s ? "bg-subtle" : s.online ? "bg-success shadow-[0_0_8px] shadow-success" : "bg-warning")}
            aria-hidden
          />
          {!s ? "Verificando…" : s.online ? "Processamento disponível" : "Processamento temporariamente indisponível"}
        </p>
        <p className="text-xs text-muted">
          {s && s.online
            ? s.queued > 0
              ? `${s.queued} na fila`
              : "Sem fila no momento"
            : "Seus pedidos ficam na fila e são processados assim que o serviço voltar."}
        </p>
      </div>
    </div>
  );
}
