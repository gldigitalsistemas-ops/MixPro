"use client";

import { useState } from "react";
import { TriangleAlert } from "lucide-react";
import { detectEnv } from "@/lib/error-log";

/**
 * Navegador de dentro do Instagram/TikTok/Facebook: pouca memória (fecha sozinho) e download bloqueado.
 * Orienta a abrir no navegador do celular, onde tudo funciona.
 */
export function InAppWarning() {
  const [app] = useState(() => (typeof navigator === "undefined" ? null : detectEnv().inApp));
  if (!app || app === "app (WebView)") return null;
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
  return (
    <div className="mx-auto flex w-full max-w-2xl gap-3 rounded-2xl border border-amber-400/40 bg-amber-400/10 p-3 text-sm" role="alert">
      <TriangleAlert className="mt-0.5 size-5 shrink-0 text-amber-300" />
      <p>
        <span className="block font-semibold">Abra no navegador do celular</span>
        <span className="text-muted">
          Você está no navegador do {app}: ele tem pouca memória, pode fechar no meio da edição e não deixa baixar o arquivo. Toque em{" "}
          <b>•••</b> e escolha <b>{ios ? "Abrir no Safari (ou no navegador)" : "Abrir no Chrome (ou no navegador)"}</b>.
        </span>
      </p>
    </div>
  );
}
