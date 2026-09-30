import { IrManager } from "./manager";

export const metadata = { title: "Caixas (IR)" };

export default function AdminCabIRs() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-display text-2xl font-semibold">Caixas gravadas (IR)</h1>
        <p className="max-w-3xl text-sm text-muted">
          IRs de caixa + microfone para o amplificador de guitarra e baixo. No app, o usuário escolhe em Personalizar → Amplificador →
          “Caixa gravada”. Envie o arquivo .wav da IR como veio do estúdio (o começo do arquivo é mantido: o atraso do microfone faz parte
          do som). Use IRs que você capturou ou com licença para uso em aplicativo.
        </p>
      </div>
      <IrManager />
    </div>
  );
}
