"use client";

/** Pede ao servidor para conferir o pagamento na API do Mercado Pago (idempotente). */
export async function confirmPayment(paymentId: string): Promise<"approved" | "failed" | "pending" | null> {
  if (!/^\d{1,20}$/.test(paymentId)) return null;
  try {
    const res = await fetch("/api/payments/confirm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ payment_id: paymentId }),
    });
    if (!res.ok) return null;
    return (await res.json()).status ?? null;
  } catch {
    return null;
  }
}

/**
 * Na volta do checkout: confere agora e, enquanto estiver pendente (ex.: PIX processando),
 * confere de novo a cada 5 s por até 1 minuto. Devolve a função de cancelamento.
 */
export function watchPaymentReturn(paymentId: string | null, onChange: () => void): () => void {
  if (!paymentId) return () => {};
  let stopped = false;
  let tries = 0;
  const tick = async () => {
    if (stopped) return;
    const status = await confirmPayment(paymentId);
    onChange();
    if (!stopped && status !== "approved" && status !== "failed" && ++tries < 12) timer = setTimeout(tick, 5000);
  };
  let timer = setTimeout(tick, 0);
  return () => {
    stopped = true;
    clearTimeout(timer);
  };
}
