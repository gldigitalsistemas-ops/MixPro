"use client";

import { useCallback, useEffect, useState } from "react";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { Bell, Download, Share, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useInstallApp } from "./pwa";

const PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "";
const DISMISS_KEY = "mixpro:convite-dispensado";
const DISMISS_DAYS = 5;

const isIos = () => typeof navigator !== "undefined" && /iphone|ipad|ipod/i.test(navigator.userAgent);
const isStandalone = () =>
  typeof window !== "undefined" &&
  (window.matchMedia?.("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true);
const pushSupported = () =>
  typeof window !== "undefined" && "Notification" in window && "serviceWorker" in navigator && "PushManager" in window && Boolean(PUBLIC_KEY);

function keyBytes(base64: string): Uint8Array<ArrayBuffer> {
  const pad = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

/** Inscreve este navegador e envia ao servidor (de novo a cada abertura: liga à conta depois do login). */
async function subscribe(): Promise<boolean> {
  const reg = await navigator.serviceWorker.ready;
  const sub =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: keyBytes(PUBLIC_KEY),
    }));
  const r = await fetch("/api/push/subscribe", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(sub),
  });
  return r.ok;
}

export async function unsubscribePush(): Promise<void> {
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  if (!sub) return;
  await fetch("/api/push/subscribe", {
    method: "DELETE",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ endpoint: sub.endpoint }),
  }).catch(() => {});
  await sub.unsubscribe().catch(() => {});
}

/** Estado das notificações neste navegador, para o cartão e para a página Conta. */
export function usePushState() {
  const [state, setState] = useState<"indisponivel" | "precisa-instalar" | "perguntar" | "ativo" | "bloqueado">("indisponivel");
  const refresh = useCallback(async () => {
    if (!pushSupported()) return setState(isIos() && !isStandalone() ? "precisa-instalar" : "indisponivel");
    if (Notification.permission === "denied") return setState("bloqueado");
    if (Notification.permission === "default") return setState("perguntar");
    const reg = await navigator.serviceWorker.ready;
    setState((await reg.pushManager.getSubscription()) ? "ativo" : "perguntar");
  }, []);
  useEffect(() => {
    // o estado vem de APIs assíncronas do navegador; muda só quando elas respondem
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
  }, [refresh]);
  const enable = useCallback(async () => {
    const perm = await Notification.requestPermission();
    if (perm === "granted") await subscribe().catch(() => false);
    await refresh();
  }, [refresh]);
  const disable = useCallback(async () => {
    await unsubscribePush();
    await refresh();
  }, [refresh]);
  return { state, enable, disable };
}

/**
 * Convite ao abrir o app: instalar (Android/computador pelo navegador; iPhone com instruções) e ativar
 * o lembrete diário. Pode ser dispensado (volta depois de alguns dias). Não aparece no admin.
 */
export function EngagementPrompt() {
  const path = usePathname();
  const install = useInstallApp();
  const { state, enable } = usePushState();
  const [dismissed, setDismissed] = useState(true);
  const [standalone, setStandalone] = useState(true);
  const [ios, setIos] = useState(false);

  useEffect(() => {
    let until = 0;
    try {
      until = Number(localStorage.getItem(DISMISS_KEY) ?? 0);
    } catch {}
    // valores do navegador, lidos só depois de montar (no servidor não existem)
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDismissed(Date.now() < until);
    setStandalone(isStandalone());
    setIos(isIos());
  }, []);

  // permissão já dada: mantém a inscrição em dia (e ligada à conta depois do login)
  useEffect(() => {
    if (pushSupported() && Notification.permission === "granted") void subscribe().catch(() => {});
  }, []);

  const showInstall = !standalone && (Boolean(install) || ios);
  const showPush = state === "perguntar";
  if (dismissed || path?.startsWith("/admin") || (!showInstall && !showPush)) return null;

  const dismiss = () => {
    try {
      localStorage.setItem(DISMISS_KEY, String(Date.now() + DISMISS_DAYS * 86_400_000));
    } catch {}
    setDismissed(true);
  };

  return (
    <div
      className="safe-x fixed inset-x-0 bottom-[calc(4.75rem+env(safe-area-inset-bottom))] z-50 px-3 md:bottom-6 md:left-auto md:right-6 md:w-96 md:px-0"
      role="dialog"
      aria-label="Instalar o Mix Pro"
    >
      <div className="glass flex flex-col gap-3 rounded-2xl border border-violet-400/30 p-4 shadow-2xl">
        <div className="flex items-start gap-3">
          <Image src="/icons/icon-192.png" alt="" width={40} height={40} className="size-10 rounded-xl" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold">Leve o Mix Pro com você</p>
            <p className="text-xs text-muted">Abra direto da tela inicial e receba um lembrete por dia para deixar seus áudios com som de estúdio.</p>
          </div>
          <button type="button" onClick={dismiss} aria-label="Agora não" className="text-muted hover:text-text">
            <X className="size-4" />
          </button>
        </div>
        {showInstall && install && (
          <Button size="sm" onClick={() => void install()}>
            <Download className="size-4" aria-hidden /> Instalar o app
          </Button>
        )}
        {showInstall && !install && ios && (
          <p className="rounded-xl bg-white/5 p-2 text-xs text-muted">
            No iPhone: toque em <Share className="inline size-3.5 align-text-bottom" aria-label="Compartilhar" /> <strong>Compartilhar</strong> e depois em{" "}
            <strong>Adicionar à Tela de Início</strong>. Os lembretes funcionam no app instalado.
          </p>
        )}
        {showPush && (
          <Button size="sm" variant="secondary" onClick={() => void enable()}>
            <Bell className="size-4" aria-hidden /> Ativar lembrete diário
          </Button>
        )}
      </div>
    </div>
  );
}
