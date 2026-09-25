export const metadata = { title: "Termos de uso" };

export default function Terms() {
  return (
    <>
      <h1>Termos de uso</h1>
      <p className="rounded-xl border border-warning/30 bg-warning/10 p-3 text-amber-200">
        Rascunho técnico: revise este texto com um profissional jurídico antes da publicação.
      </p>
      <h2>O serviço</h2>
      <p>
        O Mix Pro aplica cadeias de processamento de áudio pré-configuradas (presets) aos arquivos enviados. O resultado depende da
        qualidade da gravação original; não garantimos um resultado específico.
      </p>
      <h2>Direitos sobre os arquivos</h2>
      <p>Ao enviar um arquivo, você declara possuir os direitos ou a autorização necessária sobre ele.</p>
      <h2>Downloads e créditos</h2>
      <p>
        Ouvir previews e testar presets é gratuito. Cada download de um resultado novo consome 1 crédito. Baixar novamente um resultado já
        pago não gera nova cobrança.
      </p>
    </>
  );
}
