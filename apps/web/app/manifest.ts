import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Mix Pro",
    short_name: "Mix Pro",
    description: "Mixagem e masterização de áudio online com presets profissionais.",
    start_url: "/app",
    display: "standalone",
    background_color: "#06061a",
    theme_color: "#06061a",
    orientation: "portrait-primary",
    categories: ["music", "utilities"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    screenshots: [
      {
        src: "/og-image.jpg",
        sizes: "1200x630",
        type: "image/jpeg",
        // @ts-expect-error – form_factor is valid but not yet in Next.js types
        form_factor: "wide",
      },
    ],
  };
}
