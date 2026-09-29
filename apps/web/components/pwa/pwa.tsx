"use client";

import { useEffect, useState } from "react";

type InstallEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };

let deferred: InstallEvent | null = null;
const listeners = new Set<() => void>();

/** Registra o service worker (compartilhar pela galeria) e guarda o convite de instalação do navegador. */
export function PwaSetup() {
  useEffect(() => {
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
    const onPrompt = (e: Event) => {
      e.preventDefault();
      deferred = e as InstallEvent;
      listeners.forEach((l) => l());
    };
    const onInstalled = () => {
      deferred = null;
      listeners.forEach((l) => l());
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);
  return null;
}

/** null quando o navegador não oferece instalação (já instalado, iPhone, etc.). */
export function useInstallApp(): (() => Promise<void>) | null {
  const [available, setAvailable] = useState(false);
  useEffect(() => {
    const update = () => setAvailable(deferred !== null);
    listeners.add(update);
    const t = setTimeout(update, 0);
    return () => {
      listeners.delete(update);
      clearTimeout(t);
    };
  }, []);
  if (!available) return null;
  return async () => {
    const e = deferred;
    if (!e) return;
    await e.prompt();
    await e.userChoice.catch(() => null);
    deferred = null;
    listeners.forEach((l) => l());
  };
}

/** Arquivo recebido pelo menu "Compartilhar" (guardado pelo service worker). */
export async function takeSharedFile(): Promise<File | null> {
  if (!("caches" in window)) return null;
  const cache = await caches.open("mixpro-share");
  const res = await cache.match("/shared-media");
  if (!res) return null;
  await cache.delete("/shared-media");
  const blob = await res.blob();
  const name = decodeURIComponent(res.headers.get("x-file-name") ?? "video.mp4");
  return new File([blob], name, { type: blob.type });
}
