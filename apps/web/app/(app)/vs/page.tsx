import type { Metadata } from "next";
import { VSStudio } from "@/components/vs/vs-studio";

export const metadata: Metadata = {
  title: "Criar VS",
  description: "Separe voz, bateria, baixo e instrumentos de qualquer música e crie o clique no andamento certo. Mixe as pistas e baixe para tocar ao vivo.",
};

export default function VSPage() {
  return <VSStudio />;
}
