import type { Metadata } from "next";
import { CoverStudio } from "@/components/cover/cover-studio";

export const metadata: Metadata = {
  title: "Modo Cover",
  description: "Grave você tocando por cima da música: o app tira o seu instrumento, toca o playback no fone, sincroniza, deixa o som de estúdio e entrega o vídeo para o Instagram.",
};

export default function CoverPage() {
  return <CoverStudio />;
}
