import type { MetadataRoute } from "next";

type ShareTarget = {
  share_target: {
    action: string;
    method: "POST";
    enctype: "multipart/form-data";
    params: { title?: string; text?: string; files: { name: string; accept: string[] }[] };
  };
};

export default function manifest(): MetadataRoute.Manifest & ShareTarget {
  return {
    name: "Mix Pro — Som de estúdio e legendas",
    short_name: "Mix Pro",
    description: "Som de estúdio, remoção de ruído, legendas automáticas e cortes para os seus vídeos. Direto no celular.",
    start_url: "/estudio",
    scope: "/",
    display: "standalone",
    background_color: "#06061a",
    theme_color: "#06061a",
    orientation: "portrait-primary",
    categories: ["music", "photo", "video", "utilities"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    // Android: aparece no menu "Compartilhar" da galeria depois de instalado
    share_target: {
      action: "/compartilhar",
      method: "POST",
      enctype: "multipart/form-data",
      params: { title: "title", text: "text", files: [{ name: "media", accept: ["video/*", "audio/*"] }] },
    },
  };
}
