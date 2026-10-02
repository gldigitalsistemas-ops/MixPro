"use client";

import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";

const CURRENT = process.env.NEXT_PUBLIC_BUILD_ID ?? "";
const CHECK_EVERY_MS = 5 * 60_000;
const RELOAD_FLAG = "mixpro.chunk-reload";

/** Recarrega pegando a versão nova: atualiza o service worker e limpa caches antigos (menos o do compartilhar). */
export async function reloadToLatest() {
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    await reg?.update();
    const keys = (await caches?.keys?.()) ?? [];
    await Promise.all(keys.filter((k) => k !== "mixpro-share" && !k.startsWith("transformers") && !k.startsWith("mixpro-vs-model")).map((k) => caches.delete(k)));
  } catch {
    // segue para o recarregamento mesmo assim
  }
  const url = new URL(window.location.href);
  url.searchParams.set("v", Date.now().toString(36));
  window.location.replace(url.toString());
}

/**
 * Aviso de versão nova: confere ao abrir, ao voltar para o app e a cada 5 minutos. A edição em
 * andamento fica salva no aparelho, então atualizar não perde nada.
 * Também recarrega sozinho (uma vez) se uma parte do app de uma versão antiga não existir mais.
 */
export function UpdateBanner() {
  const [available, setAvailable] = useState(false);

  useEffect(() => {
    if (!CURRENT) return;
    let stopped = false;
    const check = async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const r = await fetch("/api/version", { cache: "no-store" });
        const { build } = (await r.json()) as { build?: string };
        if (!stopped && build && build !== CURRENT) setAvailable(true);
      } catch {
        // sem internet: tenta de novo depois
      }
    };
    void check();
    const timer = setInterval(check, CHECK_EVERY_MS);
    document.addEventListener("visibilitychange", check);
    return () => {
      stopped = true;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", check);
    };
  }, []);

  // partes do app de uma versão antiga sumiram do servidor: recarrega uma vez para a versão atual
  useEffect(() => {
    const isChunkError = (msg: string) => /ChunkLoadError|Loading chunk|dynamically imported module|Importing a module script failed/i.test(msg);
    const onError = (msg: string) => {
      if (!isChunkError(msg)) return;
      try {
        if (sessionStorage.getItem(RELOAD_FLAG)) return setAvailable(true);
        sessionStorage.setItem(RELOAD_FLAG, "1");
      } catch {}
      void reloadToLatest();
    };
    const err = (e: ErrorEvent) => onError(String(e.message ?? ""));
    const rej = (e: PromiseRejectionEvent) => onError(String((e.reason as Error)?.message ?? e.reason ?? ""));
    window.addEventListener("error", err);
    window.addEventListener("unhandledrejection", rej);
    // carregou bem: libera um novo recarregamento automático no futuro
    const ok = setTimeout(() => {
      try {
        sessionStorage.removeItem(RELOAD_FLAG);
      } catch {}
    }, 10_000);
    return () => {
      window.removeEventListener("error", err);
      window.removeEventListener("unhandledrejection", rej);
      clearTimeout(ok);
    };
  }, []);

  if (!available) return null;
  return (
    <div className="safe-x fixed inset-x-0 top-0 z-[60] flex justify-center px-3 pt-[calc(0.5rem+env(safe-area-inset-top))]" role="status">
      <div className="flex w-full max-w-md items-center gap-3 rounded-2xl border border-violet-400/40 bg-[#14102b]/95 p-3 shadow-2xl backdrop-blur">
        <RefreshCw className="size-5 shrink-0 text-violet-300" />
        <span className="min-w-0 flex-1 text-sm">
          <span className="block font-semibold">Nova versão do Mix Pro</span>
          <span className="block text-xs text-muted">Atualize para usar as melhorias. Sua edição fica salva.</span>
        </span>
        <button type="button" onClick={() => void reloadToLatest()} className="bg-brand shrink-0 rounded-xl px-3 py-2 text-sm font-semibold text-white">
          Atualizar
        </button>
      </div>
    </div>
  );
}
