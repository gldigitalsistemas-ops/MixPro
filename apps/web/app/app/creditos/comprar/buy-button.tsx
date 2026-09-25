"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";

export function BuyButton({ packId, label }: { packId: string; label: string }) {
  const [loading, setLoading] = useState(false);
  const toast = useToast();

  async function handleBuy() {
    setLoading(true);
    try {
      const res = await fetch("/api/payments/checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ pack_id: packId }),
      });
      const data = (await res.json()) as { init_point?: string; sandbox_init_point?: string; error?: string };
      if (!res.ok) {
        toast.error(data.error ?? "Erro ao iniciar pagamento.");
        return;
      }
      // Redireciona para o checkout do Mercado Pago
      const url = data.init_point ?? data.sandbox_init_point;
      if (url) window.location.href = url;
    } catch {
      toast.error("Erro de conexão. Tente novamente.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Button onClick={handleBuy} loading={loading} className="w-full">
      Comprar {label}
    </Button>
  );
}
