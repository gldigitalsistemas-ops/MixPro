"use client";

import { useEffect } from "react";
import { reportError } from "@/lib/error-log";

/** Erro no layout principal: página mínima, com estilos próprios (os globais não carregam aqui). */
export default function GlobalError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    reportError("app-inteiro", error, { context: { digest: error.digest } });
  }, [error]);
  return (
    <html lang="pt-BR">
      <body style={{ margin: 0, minHeight: "100dvh", display: "grid", placeItems: "center", background: "#06061a", color: "#f4f4ff", fontFamily: "system-ui, sans-serif" }}>
        <title>Mix Pro</title>
        <div style={{ maxWidth: 360, padding: 24, textAlign: "center" }}>
          <h1 style={{ fontSize: 20 }}>O Mix Pro teve um problema</h1>
          <p style={{ fontSize: 14, opacity: 0.75 }}>O erro já foi registrado. Sua edição fica salva no aparelho.</p>
          <div style={{ display: "flex", gap: 8, justifyContent: "center", marginTop: 16 }}>
            <button type="button" onClick={() => retry()} style={{ padding: "10px 16px", borderRadius: 12, border: 0, background: "#7c3aed", color: "#fff", fontWeight: 600 }}>
              Tentar de novo
            </button>
            <button type="button" onClick={() => window.location.reload()} style={{ padding: "10px 16px", borderRadius: 12, border: "1px solid #444", background: "transparent", color: "#fff" }}>
              Recarregar
            </button>
          </div>
        </div>
      </body>
    </html>
  );
}
