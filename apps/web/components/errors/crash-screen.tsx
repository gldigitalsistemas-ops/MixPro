"use client";

import { useEffect } from "react";
import { RefreshCw } from "lucide-react";
import { reportError } from "@/lib/error-log";

/** Tela mostrada quando uma parte do app quebra: registra o erro e oferece tentar de novo. */
export function CrashScreen({ error, retry, area }: { error: Error & { digest?: string }; retry: () => void; area: string }) {
  useEffect(() => {
    reportError(area, error, { context: { digest: error.digest } });
  }, [error, area]);
  return (
    <div className="mx-auto flex min-h-[60dvh] max-w-md flex-col items-center justify-center gap-4 p-6 text-center">
      <h1 className="font-display text-xl font-semibold">Algo deu errado nesta tela</h1>
      <p className="text-sm text-muted">
        O erro já foi registrado para a nossa equipe. Sua edição fica salva no aparelho: tente de novo ou recarregue a página.
      </p>
      <div className="flex gap-2">
        <button type="button" onClick={() => retry()} className="bg-brand rounded-xl px-4 py-2 text-sm font-semibold text-white">
          Tentar de novo
        </button>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="flex items-center gap-1 rounded-xl border border-border px-4 py-2 text-sm font-medium"
        >
          <RefreshCw className="size-4" /> Recarregar
        </button>
      </div>
    </div>
  );
}
