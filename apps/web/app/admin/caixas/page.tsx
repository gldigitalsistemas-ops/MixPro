import { IrManager } from "./manager";

export const metadata = { title: "Caixas (IR)" };

export default function AdminCabIRs() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-display text-2xl font-semibold">Caixas gravadas (IR)</h1>
        <p className="max-w-3xl text-sm text-muted">
          O app já vem com 10 caixas do Mix Pro (5 de guitarra e 5 de baixo, geradas no próprio app). Aqui você soma IRs de caixa +
          microfone gravadas em estúdio; o usuário escolhe em Personalizar → Amplificador → “Caixa e microfone”. Envie o .wav como veio
          do estúdio (o começo do arquivo é mantido: o atraso do microfone faz parte do som). Atenção: IRs gratuitas de marcas
          costumam proibir redistribuição; use só IRs que você capturou ou com licença para uso em aplicativo.
        </p>
      </div>
      <IrManager />
    </div>
  );
}
