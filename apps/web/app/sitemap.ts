import type { MetadataRoute } from "next";

export default function sitemap(): MetadataRoute.Sitemap {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  return ["", "/estudio", "/producao", "/mixar", "/produzir", "/vs", "/ferramentas", "/mixagem-profissional", "/ajuda", "/termos", "/privacidade"].map((p) => ({
    url: `${base}${p}`,
    changeFrequency: p ? "monthly" : "weekly",
    priority: p ? 0.5 : 1,
  }));
}
