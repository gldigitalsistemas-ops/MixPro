// Mix Pro — service worker mínimo: recebe vídeos/áudios pelo menu "Compartilhar" (Web Share Target).
// Não faz cache de páginas: o app sempre carrega a versão mais nova.
const SHARE_CACHE = "mixpro-share";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "POST" || url.pathname !== "/compartilhar") return;
  event.respondWith(
    (async () => {
      try {
        const form = await event.request.formData();
        const file = form.getAll("media").find((f) => f && typeof f === "object" && "size" in f);
        if (file) {
          const cache = await caches.open(SHARE_CACHE);
          await cache.put(
            "/shared-media",
            new Response(file, {
              headers: { "content-type": file.type || "application/octet-stream", "x-file-name": encodeURIComponent(file.name || "video.mp4") },
            }),
          );
          return Response.redirect("/estudio?compartilhado=1", 303);
        }
      } catch {
        // cai no redirecionamento sem arquivo
      }
      return Response.redirect("/estudio", 303);
    })(),
  );
});

// Notificação diária (Web Push com VAPID). O conteúdo vem do servidor: { title, body, url }.
self.addEventListener("push", (event) => {
  let data = { title: "Mix Pro", body: "Que tal tratar um áudio hoje?", url: "/estudio" };
  try {
    if (event.data) data = { ...data, ...event.data.json() };
  } catch {
    // mantém a mensagem padrão
  }
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      tag: "mixpro-diario",
      data: { url: typeof data.url === "string" && data.url.startsWith("/") ? data.url : "/estudio" },
    }),
  );
});

// Toque na notificação: abre (ou traz para a frente) o app na página da mensagem.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || "/estudio", self.location.origin).href;
  event.waitUntil(
    (async () => {
      const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const w of wins) {
        if (new URL(w.url).origin === self.location.origin && "focus" in w) {
          await w.focus();
          if ("navigate" in w) await w.navigate(url).catch(() => {});
          return;
        }
      }
      await self.clients.openWindow(url);
    })(),
  );
});
