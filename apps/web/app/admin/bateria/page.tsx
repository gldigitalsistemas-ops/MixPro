import { SampleManager } from "./manager";

export const metadata = { title: "Samples de bateria" };

export default function AdminDrumSamples() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-display text-2xl font-semibold">Samples de bateria</h1>
        <p className="max-w-3xl text-sm text-muted">
          Os tambores que o usuário escolhe na Bateria de Estúdio. Envie várias batidas da mesma peça (da mais leve à mais forte)
          para o som não ficar repetitivo: o app escolhe a camada pela força de cada batida do baterista. Use só samples que você
          gravou ou que têm licença para uso dentro de aplicativo.
        </p>
      </div>
      <SampleManager />
    </div>
  );
}
