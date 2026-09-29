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
