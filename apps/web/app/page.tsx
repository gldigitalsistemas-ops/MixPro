import type { Metadata } from "next";
import { Studio } from "@/components/studio/studio";

export const metadata: Metadata = {
  title: "Mix Pro — Som de estúdio nos seus vídeos, grátis",
  description:
    "Melhore o áudio dos seus vídeos para Reels, TikTok e YouTube: escolha um preset profissional, compare antes e depois e baixe o vídeo pronto para postar. Grátis, direto no celular, sem enviar seu arquivo.",
  keywords: [
    "melhorar áudio do vídeo",
    "melhorar som do vídeo",
    "áudio para reels",
    "áudio para tiktok",
    "voz de podcast",
    "masterização online",
    "mixagem online grátis",
  ],
  openGraph: {
    title: "Mix Pro — Som de estúdio nos seus vídeos",
    description: "Presets profissionais de áudio para quem grava vídeos. Grátis e direto no celular.",
    type: "website",
  },
};

export default function Home() {
  return <Studio />;
}
