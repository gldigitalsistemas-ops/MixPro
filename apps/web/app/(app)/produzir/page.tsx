import { ComposeWizard } from "@/components/premium/compose-wizard";

export const metadata = { title: "Produza sua composição", description: "Envie a guia da sua música e uma referência: a IA cria a produção, você grava a voz e recebe a música pronta." };

export default function ProduzirPage() {
  return <ComposeWizard />;
}
